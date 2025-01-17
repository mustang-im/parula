import { AuthMethod, MailAccount, TLSSocketType } from "../MailAccount";
import type { EMail } from "../EMail";
import { EWSFolder } from "./EWSFolder";
import { ensureArray } from "./EWSEMail";
import EWSCreateItemRequest from "./EWSCreateItemRequest";
import type EWSDeleteItemRequest from "./EWSDeleteItemRequest";
import type EWSUpdateItemRequest from "./EWSUpdateItemRequest";
import { EWSAddressbook } from "../../Contacts/EWS/EWSAddressbook";
import { EWSCalendar } from "../../Calendar/EWS/EWSCalendar";
import type { PersonUID } from "../../Abstract/PersonUID";
import { OAuth2 } from "../../Auth/OAuth2";
import { OAuth2URLs } from "../../Auth/OAuth2URLs";
import { ContentDisposition } from "../Attachment";
import { ConnectError, LoginError } from "../../Abstract/Account";
import { appGlobal } from "../../app";
import { blobToBase64 } from "../../util/util";
import { assert } from "../../util/util";

type Json = string | number | boolean | null | Json[] | {[key: string]: Json};

type JsonRequest = Json | EWSCreateItemRequest | EWSDeleteItemRequest | EWSUpdateItemRequest;

export class EWSAccount extends MailAccount {
  readonly protocol: string = "ews";
  readonly port: number = 443;
  readonly tls = TLSSocketType.TLS;
  readonly folderMap = new Map<string, EWSFolder>;

  constructor() {
    super();
    assert(appGlobal.remoteApp.postHTTP, "EWS: Need backend");
  }

  newFolder(): EWSFolder {
    return new EWSFolder(this);
  }

  get isLoggedIn(): boolean {
    return this.oAuth2?.isLoggedIn;
  }

  async login(interactive: boolean): Promise<void> {
    if (this.authMethod == AuthMethod.OAuth2) {
      let urls = OAuth2URLs.find(a => a.hostnames.includes(this.hostname));
      this.oAuth2 = new OAuth2(this, urls.tokenURL, urls.authURL, urls.authDoneURL, urls.scope, urls.clientID, urls.clientSecret);
      this.oAuth2.setTokenURLPasswordAuth(urls.tokenURLPasswordAuth);
      this.oAuth2.subscribe(() => this.notifyObservers());
      await this.oAuth2.login(interactive);
    }
    await this.listFolders();

    let addressbook = appGlobal.addressbooks.find((addressbook: EWSAddressbook) => addressbook.protocol == "addressbook-ews" && addressbook.url == this.url && addressbook.username == this.emailAddress) as EWSAddressbook | void;
    if (!addressbook) {
      addressbook = new EWSAddressbook();
      addressbook.name = this.name;
      addressbook.url = this.url;
      addressbook.username = this.emailAddress;
      addressbook.workspace = this.workspace;
      appGlobal.addressbooks.add(addressbook);
    }
    addressbook.account = this;
    await addressbook.listContacts();

    let calendar = appGlobal.calendars.find((calendar: EWSCalendar) => calendar.protocol == "calendar-ews" && calendar.url == this.url && calendar.username == this.emailAddress) as EWSCalendar | void;
    if (!calendar) {
      calendar = new EWSCalendar();
      calendar.name = this.name;
      calendar.url = this.url;
      calendar.username = this.emailAddress;
      calendar.workspace = this.workspace;
      appGlobal.calendars.add(calendar);
    }
    calendar.account = this;
    await calendar.listEvents();

    await this.streamNotifications();
  }

  async logout(): Promise<void> {
    // Not sure what the intention is here.
  }

  async send(email: EMail): Promise<void> {
    let request = new EWSCreateItemRequest({MessageDisposition: "SendAndSaveCopy"});
    request.addField("Message", "ItemClass", "IPM.Note", "item:ItemClass");
    request.addField("Message", "Subject", email.subject, "item:Subject");
    request.addField("Message", "Body", {
      BodyType: email.html ? "HTML" : "Text",
      _TextContent_: email.html || email.text,
    }, "item:Body");
    if (email.attachments.hasItems) {
      request.addField("Message", "Attachments", {
        t$ItemAttachment: await Promise.all(email.attachments.contents.map(async attachment => ({
          t$Name: attachment.filename,
          t$ContentType: attachment.mimeType,
          t$ContentID: attachment.contentID,
          t$Size: attachment.size,
          t$IsInline: attachment.disposition == ContentDisposition.inline,
          t$Content: await blobToBase64(attachment.content),
        }))),
      }, "item:Attachments");
    }
    if (email.inReplyTo) {
      request.addField("Message", "InReplyTo", email.inReplyTo, "item:InReplyTo");
    }
    if (email.replyTo) {
      addRecipients(request, "ReplyTo", [email.replyTo]);
    }
    addRecipients(request, "From", [email.from]);
    addRecipients(request, "ToRecipients", email.to.contents);
    addRecipients(request, "CcReipients", email.cc.contents);
    addRecipients(request, "BccRecipients", email.bcc.contents);
    await this.callEWS(request);
  }

  JSON2XML(aJSON: JsonRequest, aParent: Element, aNS: string, aTag: string): void {
    if (aJSON == null) {
      return;
    }
    if (Array.isArray(aJSON)) {
      for (let value of aJSON) {
        this.JSON2XML(value, aParent, aNS, aTag);
      }
      return;
    }
    let element = aParent.ownerDocument.createElementNS(aNS, aTag);
    aParent.appendChild(element);
    if (typeof aJSON != "object") {
      element.textContent = String(aJSON);
      return;
    }
    for (let key in aJSON) {
      if (key == "_TextContent_") {
        element.textContent = String(aJSON[key]);
      } else if (key.includes("$")) {
        let ns = aParent.ownerDocument.documentElement.getAttributeNS("http://www.w3.org/2000/xmlns/", key.slice(0, key.indexOf("$")));
        let tagName = key.replace("$", ":");
        this.JSON2XML(aJSON[key], element, ns, tagName);
      } else {
        element.setAttribute(key, String(aJSON[key]));
      }
    }
  }

  request2XML(aRequest: JsonRequest): string {
    let xml = document.implementation.createDocument("http://schemas.xmlsoap.org/soap/envelope/", "s:Envelope");
    xml.documentElement.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:s", "http://schemas.xmlsoap.org/soap/envelope/");
    xml.documentElement.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:m", "http://schemas.microsoft.com/exchange/services/2006/messages");
    xml.documentElement.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:t", "http://schemas.microsoft.com/exchange/services/2006/types");
    this.JSON2XML({
      t$RequestServerVersion: {
        Version: "Exchange2013",
      },
      t$TimeZoneContext: {
        t$TimeZoneDefinition: {
          Id: "UTC",
        },
      },
    }, xml.documentElement, "http://schemas.xmlsoap.org/soap/envelope/", "s:Header");
    this.JSON2XML(aRequest, xml.documentElement, "http://schemas.xmlsoap.org/soap/envelope/", "s:Body");
    return new XMLSerializer().serializeToString(xml);
  }

  checkResponse(aResponse, aRequest: JsonRequest): Json {
    let responseXML = aResponse.responseXML;
    if (!responseXML) {
      throw new EWSError(aResponse, aRequest);
    }
    let messages = responseXML.querySelector("ResponseMessages");
    if (!messages) {
      throw new EWSError(aResponse, aRequest);
    }
    let message = Object.values(XML2JSON(messages))[0];
    if (message.ResponseClass == "Error") {
      throw new EWSItemError(message, aRequest);
    }
    return message;
  }

  parseXML(aXMLasText: string): Document {
    let cleanText = aXMLasText.replace(/&#x([0-8BCEF]|1[0-9A-F]|D[89A-F][0-9A-F][0-9A-F]|FFF[EF]);/gi, "");
    let document = new DOMParser().parseFromString(cleanText, "text/xml");
    return document.getElementsByTagName('parsererror').length ? null : document;
  }

  createRequestOptions(throwHttpErrors = false): Promise<any> {
    let options: any = {
      throwHttpErrors,
      headers: {
        'Content-Type': "text/xml; charset=utf-8",
      },
    };
    if (this.oAuth2) {
      options.headers.Authorization = this.oAuth2.authorizationHeader;
    } else {
      options.headers.Authorization = `Basic ${btoa(unescape(encodeURIComponent(`${this.username || this.emailAddress}:${this.password}`)))}`;
    }
    return options;
  }

  async callEWS(aRequest: JsonRequest): Promise<any> {
    let response = await appGlobal.remoteApp.postHTTP(this.url, this.request2XML(aRequest), "text", this.createRequestOptions());
    response.responseXML = this.parseXML(response.data);
    this.fatalError = null;
    if (response.status == 200) {
      return this.checkResponse(response, aRequest);
    }
    if (response.status == 401) {
      if (this.oAuth2) {
        this.oAuth2.reset();
        await this.oAuth2.login(false); // will throw error, if interactive login is needed
        return await this.callEWS(aRequest); // repeat the call
      } else if (!/\bBasic\b/.test(response.WWWAuthenticate)) {
        throw this.fatalError = new ConnectError(null,
          "Unsupported authentication protocol(s): " + response.WWWAuthenticate);
      } else {
        throw this.fatalError = new LoginError(null,
          "Password incorrect");
      }
    } else {
      throw new EWSError(response, aRequest);
    }
  }

  async callStream(request: Json, responseCallback) {
    let lastAttempt = Date.now();
    while (Date.now() - lastAttempt > 10000) { // quit when last failure < 10 seconds ago. TODO throw? But don't show error to user.
      try {
        lastAttempt = Date.now();
        const endEnvelope = "</Envelope>";
        let requestXML = this.request2XML(request);
        let data = "";
        let response = await appGlobal.remoteApp.streamHTTP(this.url, requestXML, this.createRequestOptions(true));
        if (!response.ok) {
          console.error(`streamHTTP failed with HTTP {response.status} {response.statusText}`);
          return;
        }
        for await (let chunk of response.body) {
          data += chunk;
          while (data.includes(endEnvelope)) {
            let pos = data.indexOf(endEnvelope) + endEnvelope.length;
            chunk = data.slice(0, pos);
            data = data.slice(pos);
            try {
              let document = this.parseXML(chunk);
              if (!document) {
                continue;
              }
              let messages = document.querySelector("ResponseMessages");
              if (!messages) {
                continue;
              }
              let message = Object.values(XML2JSON(messages))[0];
              if (message.ResponseClass == "Error") {
                throw new EWSItemError(message, request);
              }
              if (message.ConnectionStatus == "Closed") {
                continue; // Re-open connection
              }
              responseCallback(message);
            } catch (ex) {
              this.errorCallback(ex);
            }
          }
        }
      } catch (ex) {
        if (ex?.message == "terminated") {
          // Connection broke down, which is normal after a while.
          // Loop and re-open the connection.
          continue;
        }
        this.errorCallback(ex);
        break;
      }
    }
  }

  async streamNotifications() {
    let subscribe = {
      m$Subscribe: {
        m$StreamingSubscriptionRequest: {
          t$EventTypes: {
            t$EventType: [
              "CopiedEvent",
              "CreatedEvent",
              "DeletedEvent",
              "ModifiedEvent",
              "MovedEvent",
              "NewMailEvent",
            ],
          },
          SubscribeToAllFolders: true,
        },
      },
    };
    let response = await this.callEWS(subscribe);
    let streamRequest = {
      m$GetStreamingEvents: {
        m$SubscriptionIds: {
          t$SubscriptionId: response.SubscriptionId,
        },
        // Maximum number of minutes to keep a stream open.
        // In minutes, between 1 and 30, inclusive.
        m$ConnectionTimeout: 29, // minutes
      },
    };
    this.callStream(streamRequest, async message => {
      for (let notification of ensureArray(message.Notifications?.Notification)) {
        await this.processNotification(notification);
      }
    });
  }

  async processNotification(notification) {
    let hierarchyChanged = false;
    let folderIDs = new Set<string>();
    for (let copiedEvent of ensureArray(notification.CopiedEvent)) {
      if (copiedEvent.ItemId) {
        folderIDs.add(copiedEvent.ParentFolderId.Id);
      } else if (copiedEvent.FolderId) {
        hierarchyChanged = true;
      } else {
        this.errorCallback(new Error("CopiedEvent did not conform to schema"));
      }
    }
    for (let createdEvent of ensureArray(notification.CreatedEvent)) {
      if (createdEvent.ItemId) {
        folderIDs.add(createdEvent.ParentFolderId.Id);
      } else if (createdEvent.FolderId) {
        hierarchyChanged = true;
      } else {
        this.errorCallback(new Error("CreatedEvent did not conform to schema"));
      }
    }
    for (let deletedEvent of ensureArray(notification.DeletedEvent)) {
      if (deletedEvent.ItemId) {
        folderIDs.add(deletedEvent.ParentFolderId.Id);
      } else if (deletedEvent.FolderId) {
        hierarchyChanged = true;
      } else {
        this.errorCallback(new Error("DeletedEvent did not conform to schema"));
      }
    }
    for (let modifiedEvent of ensureArray(notification.ModifiedEvent)) {
      if (modifiedEvent.ItemId) {
        folderIDs.add(modifiedEvent.ParentFolderId.Id);
      } else if (modifiedEvent.FolderId) {
        hierarchyChanged = true;
      } else {
        this.errorCallback(new Error("ModifiedEvent did not conform to schema"));
      }
    }
    for (let movedEvent of ensureArray(notification.MovedEvent)) {
      if (movedEvent.ItemId) {
        folderIDs.add(movedEvent.OldParentFolderId.Id);
        folderIDs.add(movedEvent.ParentFolderId.Id);
      } else if (movedEvent.FolderId) {
        hierarchyChanged = true;
      } else {
        this.errorCallback(new Error("MovedEvent did not conform to schema"));
      }
    }
    for (let newMailEvent of ensureArray(notification.NewMailEvent)) {
      folderIDs.add(newMailEvent.ParentFolderId.Id);
    }
    if (hierarchyChanged) {
      try {
        await this.listFolders();
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    for (let folderID of folderIDs) {
      try {
        let folder = this.folderMap.get(folderID);
        if (folder) {
          await folder.updateChangedMessages();
        }
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
  }

  async listFolders(): Promise<void> {
    let query = {
      m$FindFolder: {
        Traversal: "Deep",
        m$FolderShape: {
          t$BaseShape: "Default",
          t$AdditionalProperties: {
            t$FieldURI: [{
              FieldURI: "folder:FolderClass",
            }, {
              FieldURI: "folder:ParentFolderId",
            }, {
              FieldURI: "folder:DistinguishedFolderId",
            }],
          },
        },
        m$ParentFolderIds: {
          t$DistinguishedFolderId: [{
            Id: "msgfolderroot",
          }],
        },
      },
    };
    let result = await this.callEWS(query);
    for (let folder of result.RootFolder.Folders.Folder) {
      if (!folder.FolderClass || folder.FolderClass == "IPF.Note" || folder.FolderClass.startsWith("IPF.Note.")) {
        let parent = this.folderMap.get(folder.ParentFolderId.Id);
        let parentFolders = parent ? parent.subFolders : this.rootFolders;
        let ewsFolder = parentFolders.find(ewsFolder => ewsFolder.id == folder.FolderId.Id) as EWSFolder;
        if (!ewsFolder) {
          ewsFolder = this.newFolder();
          ewsFolder.parent = parent || null;
          parentFolders.push(ewsFolder);
        }
        ewsFolder.fromXML(folder);
        this.folderMap.set(folder.FolderId.Id, ewsFolder);
      }
    }
  }
}


function XML2JSON(aNode: Element): Json {
  if (!aNode.children.length && !aNode.attributes.length) {
    return aNode.textContent;
  }
  let result: Json = {};
  for (let { name, value } of aNode.attributes) {
    result[name] = value;
  }
  if (aNode.childNodes.length && !aNode.children.length) {
    result.Value = aNode.textContent;
  }
  for (let child of aNode.children) {
    if (result[child.localName]) {
      if (!Array.isArray(result[child.localName])) {
        result[child.localName] = [result[child.localName]];
      }
      (result[child.localName] as Json[]).push(XML2JSON(child));
    } else {
      result[child.localName] = XML2JSON(child);
    }
  }
  return result;
}

class EWSError extends Error {
  readonly request: Json;
  readonly status: number;
  readonly statusText: string;
  readonly type: string;
  readonly XML: Json | undefined;
  readonly error: Json | undefined;
  readonly responseText: string | undefined;
  constructor(aResponse, aRequest) {
    let message = aResponse.statusText;
    try {
      let responseXML = aResponse.responseXML;
      let messageNode = responseXML.querySelector("Message");
      if (messageNode) {
        message = messageNode.textContent;
      }
      let errorNode = responseXML.querySelector("[ResponseClass=\"Error\"]");
      if (errorNode) {
        let errorResponse = XML2JSON(errorNode) as any;
        message = errorResponse.MessageText;
      }
      let innerErrorNode = responseXML.querySelector("[Name=\"InnerErrorMessageText\"]");
      if (innerErrorNode) {
        message = innerErrorNode.textContent;
      }
    } catch (ex) {
    }
    super(message);
    this.request = aRequest;
    this.status = aResponse.status;
    this.statusText = aResponse.statusText;
    this.type = 'HTTP ' + aResponse.status;
    try {
      let responseXML = aResponse.responseXML;
      let messageNode = responseXML.querySelector("Message");
      let responseCode = responseXML.querySelector("ResponseCode");
      if (responseCode) {
        this.type = responseCode.textContent;
      }
      let errorNode = responseXML.querySelector("[ResponseClass=\"Error\"]");
      if (errorNode) {
        let errorResponse = XML2JSON(errorNode) as any;
        this.type = errorResponse.ResponseCode;
      }
      let innerErrorNode = responseXML.querySelector("[Name=\"InnerErrorResponseCode\"]");
      if (innerErrorNode) {
        this.type = innerErrorNode.textContent;
      }
      let xmlNode = responseXML.querySelector("MessageXml");
      if (xmlNode) {
        // This identifies the XML element causing the error.
        this.XML = XML2JSON(xmlNode);
      }
      if (messageNode || responseCode || errorNode || xmlNode) {
        this.error = XML2JSON(responseXML.documentElement);
      }
    } catch (ex) {
      // The response wasn't XML, so we can't extract an error message.
      this.responseText = aResponse.data;
    }
  }
}

class EWSItemError extends Error {
  readonly request: JsonRequest;
  readonly error: Json;
  readonly type: string;
  constructor(errorResponseJSON: any, aRequest: JsonRequest) {
    if (Array.isArray(errorResponseJSON.MessageXml?.Value)) {
      for (let { Name, Value } of errorResponseJSON.MessageXml.Value) {
        errorResponseJSON[Name.replace(/^InnerError/, "")] = Value;
      }
    }
    super(errorResponseJSON.MessageText);
    this.request = aRequest;
    this.error = errorResponseJSON as Json;
    this.type = errorResponseJSON.ResponseCode;
  }
}

function addRecipients(aRequest: any, aType: string, aRecipients: PersonUID[]): void {
  if (!aRecipients.length) {
    return;
  }
  aRequest.addField("Message", aType, {
    t$Mailbox: aRecipients.map(recipient => ({
      t$Name: recipient.name,
      t$EmailAddress: recipient.emailAddress,
    })),
  }, "message:" + aType);
}
