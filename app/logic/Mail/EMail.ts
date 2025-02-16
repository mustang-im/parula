import { Message } from "../Abstract/Message";
import { SpecialFolder, type Folder } from "./Folder";
import { EMailActions } from "./EMailActions";
import { Attachment, ContentDisposition } from "../Abstract/Attachment";
import type { Tag } from "./Tag";
import { DeleteStrategy, type MailAccountStorage } from "./MailAccount";
import { PersonUID, findOrCreatePersonUID } from "../Abstract/PersonUID";
import type { MailIdentity } from "./MailIdentity";
import { Event } from "../Calendar/Event";
import { Scheduling, type Responses } from "../Calendar/Invitation";
import { EMailProcessorList, ProcessingStartOn } from "./EMailProccessor";
import { fileExtensionForMIMEType, blobToDataURL, assert, AbstractFunction } from "../util/util";
import { gt } from "../../l10n/l10n";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { PromiseAllDone } from "../util/PromiseAllDone";
import { notifyChangedProperty } from "../util/Observable";
import { Lock } from "../util/Lock";
import { Collection, ArrayColl, MapColl, SetColl } from "svelte-collections";
import PostalMIME from "postal-mime";

export class EMail extends Message {
  @notifyChangedProperty
  subject: string = "";
  @notifyChangedProperty
  from = new PersonUID();
  @notifyChangedProperty
  replyTo: PersonUID | null = null;
  readonly to = new ArrayColl<PersonUID>();
  readonly cc = new ArrayColl<PersonUID>();
  readonly bcc = new ArrayColl<PersonUID>();
  /** Tags/keywords that apply to this message.
   * To modify them (based on user input, not reading), use addTag()/removeTag()
   * @see Tag */
  readonly tags = new SetColl<Tag>();
  readonly headers = new MapColl<string, string>();
  /** Size of full RFC822 MIME message, in bytes */
  @notifyChangedProperty
  size: number;
  /** List of parent message IDs, starting with top level and ending with direct parent.
   * The last entry should theoretically match `inReplyTo`. */
  @notifyChangedProperty
  references: string[] | null = null;

  /** This is a Junk message */
  @notifyChangedProperty
  isSpam = false;
  /** The user has answered this message, by clicking "Reply" */
  @notifyChangedProperty
  isReplied = false;
  /** The user started writing this message, but didn't send it yet */
  @notifyChangedProperty
  isDraft = false;
  @notifyChangedProperty
  isDeleted = false;
  /** Complete MIME source of the email */
  @notifyChangedProperty
  mime: Uint8Array | undefined;
  @notifyChangedProperty
  scheduling: Scheduling = Scheduling.None;
  @notifyChangedProperty
  event: Event | null = null;
  folder: Folder;
  /** msg ID of the thread starter message */
  threadID: string | null = null;
  /** Protocol-specific ID for this email.
   * E.g. UID or seq for IMAP, or EWS ID string.
   * The type string or number depends on the protocol.
   * Each protocol defines a get/set function with the protocol-specific name,
   * E.g. `IMAPEMail.uid: number` and `EWSEMail.itemID: string` are getters for pID. */
  pID: string | number | null = null;
  /** This message has been downloaded completely,
   * with header, body, and all attachments. */
  downloadComplete = false;
  /** Was just downloaded, but wasn't saved to local disk yet.
   * Set only temporarily. */
  needSave = false;
  /** Body hasn't been loaded yet */
  @notifyChangedProperty
  needToLoadBody = true;
  @notifyChangedProperty
  haveCID = false;
  /** For SQLEMail and alternatives only */
  storageLock = new Lock();
  /** For composer only. Optional. */
  identity: MailIdentity;

  constructor(folder: Folder) {
    super();
    this.folder = folder;
  }

  get messageID(): string {
    return this.id;
  }
  set messageID(val: string) {
    this.id = val;
  }

  get baseSubject(): string {
    return this.subject.replace(/^((Re|RE|AW|Aw): ?)+/g, "");
  }

  get storage(): MailAccountStorage {
    return this.folder.account.storage;
  }

  /** Marks as spam, and deletes or moves the message, as configured */
  async treatSpam(isSpam = true) {
    let strategy = this.folder.account.spamStrategy;
    if (strategy == DeleteStrategy.MoveToTrash) {
      let spamFolder = this.folder.account.getSpecialFolder(SpecialFolder.Spam);
      assert(spamFolder, gt`Spam folder is not set. Please go to folder properties and set Use As: Spam.`);
      if (isSpam) {
        /** Immediate reaction for end user */
        await this.deleteMessageLocally();
        await this.markSpam(isSpam);
        spamFolder.moveMessageHere(this);
      } else {
        await this.markSpam(isSpam);
        if (this.folder == spamFolder) {
          this.folder.account.inbox.moveMessageHere(this);
        }
      }
    } else if (strategy == DeleteStrategy.DeleteImmediately) {
      if (isSpam) {
        /** Immediate reaction for end user */
        await this.deleteMessageLocally();
        await this.markSpam(isSpam);
        /* The spam flag change might trigger a folder listener
        * from the server, which re-adds this message to the local list.
        * So, we might have to delete it locally again */
        await this.deleteMessage();
      } else {
        await this.markSpam(isSpam);
      }
    }
  }

  /** You probably want to call @see treatSpam() */
  async markSpam(isSpam = true) {
    this.isSpam = isSpam;
  }

  async markReplied() {
    this.isReplied = true;
  }

  async markDraft(isDraft = true) {
    this.isDraft = isDraft;
    if (this.dbID) {
      await this.storage.saveMessageWritableProps(this);
    }
  }

  async moveToArchive() {
    let account = this.folder.account;
    let archive = account.getSpecialFolder(SpecialFolder.Archive);
    if (!archive) {
      archive = await account.inbox.createSubFolder(gt(`Archive`));
      archive.specialFolder = SpecialFolder.Archive; // TODO set on server
    }
    archive.moveMessageHere(this);
  }

  async deleteMessage() {
    await this.deleteMessageLocally();
    await this.deleteMessageOnServer();
  }

  async deleteMessageLocally() {
    this.isDeleted = true;
    this.folder.messages.remove(this);
    await this.storage.deleteMessage(this);
  }

  async deleteMessageOnServer() {
  }

  async addTag(tag: Tag) {
    this.tags.add(tag);
    await this.storage.saveMessageTags(this);
    await this.addTagOnServer(tag);
  }

  async removeTag(tag: Tag) {
    this.tags.remove(tag);
    await this.storage.saveMessageTags(this);
    await this.removeTagOnServer(tag);
  }

  async addTagOnServer(tag: Tag) {
  }

  async removeTagOnServer(tag: Tag) {
  }

  async respondToInvitation(response: Responses): Promise<void> {
    assert(this.scheduling == Scheduling.Request, "Only invitations can be responded to");
    throw new AbstractFunction();
  }

  protected async sendInvitationResponse(response: Responses): Promise<void> {
    throw new Error("Implement me!"); // TODO
  }

  async loadEvent() {
    assert(this.scheduling, "This is not an invitation or response");
    assert(!this.event, "Event has already been loaded");
    if (this.mime) {
      await this.parseMIME();
    } else {
      await this.loadMIME();
    }
  }

  async parseMIME() {
    assert(this.mime?.length, "MIME source not yet downloaded");
    assert(this.mime instanceof Uint8Array, "MIME source should be a byte array");
    //console.log("MIME source", this.mime, new TextDecoder("utf-8").decode(this.mime));
    // We may need access to internal PostalMIME data.
    let postalMIME: any = new PostalMIME();
    let mail = await postalMIME.parse(this.mime);

    // Headers
    /** TODO header.key returns Uint8Array
    for (let header of mail.headers) {
      try {
        this.headers.set(sanitize.nonemptystring(header.key), sanitize.nonemptystring(header.value));
      } catch (ex) {
        this.folder.account.errorCallback(ex);
      }
    }*/

    if (!this.id || !this.subject || !this.from || !this.sent) {
      this.id = sanitize.string(mail.messageId, this.id ?? "");
      this.subject = sanitize.string(mail.subject, this.subject ?? "");
      this.sent = sanitize.date(mail.date, this.sent ?? new Date());
      if (mail.from?.address) {
        this.from = findOrCreatePersonUID(sanitize.nonemptystring(mail.from.address), sanitize.label(mail.from.name, null));
      } else {
        this.from = findOrCreatePersonUID("unknown@invalid", "Unknown");
      }
    }
    setPersons(this.to, mail.to);
    setPersons(this.cc, mail.cc);
    setPersons(this.bcc, mail.bcc);
    this.outgoing = this.folder?.account.identities.some(id => id.isEMailAddress(this.from.emailAddress));
    this.contact = this.outgoing ? this.to.first : this.from;
    if (!this.replyTo && mail.replyTo?.length) {
      let p = mail.replyTo[0];
      this.replyTo = findOrCreatePersonUID(sanitize.nonemptystring(p.address, "unknown@invalid"), sanitize.label(p.name, null));
    }
    if (!this.inReplyTo) {
      this.inReplyTo = this.threadID = sanitize.string(mail.inReplyTo, null);
    }
    this.references = sanitize.string(mail.references, null)?.split(" ");

    // Body
    this.text = mail.text;
    let html = sanitize.string(mail.html, null);
    if (html) {
      this.html = html;
    }
    for (let processor of EMailProcessorList.processors) {
      if (processor.runOn != ProcessingStartOn.Parse) {
        continue;
      }
      await processor.process(this, postalMIME);
    }
    this.needToLoadBody = false;
    this.haveCID = false;

    // Attachments
    let fallbackID = 0;
    this.attachments.clear();
    this.attachments.addAll(mail.attachments.map(a => {
      try {
        let attachment = new Attachment();
        attachment.contentID = sanitize.nonemptystring(a.contentId, "" + ++fallbackID);
        attachment.mimeType = sanitize.nonemptystring(a.mimeType, "application/octet-stream");
        attachment.filename = sanitize.nonemptystring(a.filename, "attachment-" + fallbackID + "." + fileExtensionForMIMEType(attachment.mimeType));
        attachment.disposition = sanitize.translate(a.disposition, {
          attachment: ContentDisposition.attachment,
          inline: ContentDisposition.inline,
        }, ContentDisposition.unknown);
        attachment.related = sanitize.boolean(a.related, false);
        attachment.content = new File([a.content], attachment.filename, { type: attachment.mimeType });
        attachment.size = sanitize.integer(attachment.content.size, -1);
        return attachment;
      } catch (ex) {
        this.folder.account.errorCallback(ex);
      }
    }).filter(attachment => !!attachment));
  }

  /**
   * Saves the email
   * 1. in the database (meta-data, body text)
   * 2. attachments as raw files
   * 3. the MIME source as mail.zip
   *
   * Do this only exactly once per email `dbID`.
   * This typically happens immediately after`parseMIME()`. */
  async saveCompleteMessage() {
    if (this.isDeleted || !this.mime || await this.isDownloadCompleteDoublecheck()) {
      return;
    }
    await this.storage.saveMessage(this);
    let contentSaves = new PromiseAllDone();
    for (let contentStorage of this.folder.account.contentStorage) {
      contentSaves.add(contentStorage.save(this));
    }
    await contentSaves.wait();
    this.downloadComplete = true;
    await this.storage.saveMessageWritableProps(this); // save downloadComplete = true
  }

  protected async isDownloadCompleteDoublecheck(): Promise<boolean> {
    if (this.downloadComplete) {
      return true;
    }
    // Double-check for concurrent downloads
    let check = this.folder.newEMail();
    check.dbID = this.dbID;
    await this.storage.readMessageWritableProps(check);
    return check.downloadComplete;
  }

  async loadMIME() {
    if (this.mime) {
      return;
    }
    if (this.dbID) {
      try {
        await this.storage.readMessage(this);
        await this.folder.account.contentStorage.first.read(this);
        if (this.mime) {
          await this.parseMIME();
          return;
        }
      } catch (ex) {
        console.error(ex);
      }
    }
    await this.download();
  }

  async loadAttachments() {
    if (this.attachments.every(a => a.content)) {
      return;
    }
    try {
      let att = this.folder.account.contentStorage.find(store => (store as any).readAttachment); // RawFilesAttachment
      assert(att, "Raw attachment storage not configured");
      await att.read(this);
    } catch (ex) {
      console.error(ex);
      // fallback
      await this.loadMIME();
    }
  }

  async loadBody() {
    if (this.needToLoadBody) {
      if (this.dbID) {
        await this.storage.readMessageBody(this);
      }
      if (this.needToLoadBody) {
        await this.download();
      }
    }
    if (this.haveCID) {
      return;
    }

    let html = super.html;
    if (html && this.attachments.hasItems) {
      this._sanitizedHTML = await addCID(html, this);
    }
    this.haveCID = true; // triggers reload
  }

  get html(): string {
    if (this.needToLoadBody) {
      // observers will trigger reload
      this.loadBody().catch(this.folder.account.errorCallback);
      return this.downloadingMsg();
    }
    return super.html;
  }
  set html(val: string) {
    super.html = val;
  }

  get text(): string {
    if (this.needToLoadBody) {
      // observers will trigger reload
      this.loadBody().catch(this.folder.account.errorCallback);
      return this.downloadingMsg();
    }

    return super.text;
  }
  set text(val: string) {
    super.text = val;
  }

  protected downloadingMsg(): string {
    return this.dbID
      ? "Message content not downloaded yet"
      : "Message not loaded yet";
  }

  async download() {
    throw new AbstractFunction();
    //this.mime = await SMTPAccount.getMIME(this);
  }

  async findThread(messages: Collection<EMail>): Promise<string | null>{
    if (!this.dbID) {
      return null;
    }
    let threadID = this.threadID ?? this.inReplyTo;
    let lastThreadIDs = new SetColl<string>();
    while (threadID && !lastThreadIDs.contains(threadID)) {
      lastThreadIDs.add(threadID);
      console.log("finding thread", threadID);
      let parent = messages.find(msg => msg.threadID == threadID || msg.messageID == threadID)
        //?? await findMessageByID(threadID);
      threadID = parent?.threadID ?? parent?.inReplyTo;
      if (threadID && parent.threadID != threadID) {
        parent.threadID = threadID;
        await this.storage.saveMessageWritableProps(parent);
      }
    }
    if (threadID && this.threadID != threadID) {
      this.threadID = threadID;
      await this.storage.saveMessageWritableProps(this);
    }
    return this.threadID;
  }

  get action(): EMailActions {
    return new EMailActions(this);
  }
}

/** For inline images, convert `cid:` URIs into `data:` URIs. */
async function addCID(html: string, email: EMail): Promise<string> {
  try {
    let doc = new DOMParser().parseFromString(html, "text/html");
    let imgs = doc.querySelectorAll("img[src]");
    if (imgs.length) {
      await email.loadAttachments();
    }
    for (let img of imgs) {
      let src = img.getAttribute("src");
      if (!src || !src.startsWith("cid:")) {
        continue;
      }
      let cid = src.substring(4);
      let attachment = email.attachments.find(a => a.contentID == "<" + cid + ">");
      src = attachment?.content
        ? await blobToDataURL(attachment.content)
        : "";
      img.setAttribute("src", src);
    }
    html = new XMLSerializer().serializeToString(doc);
  } catch (ex) {
    email.folder.account.errorCallback(ex);
  }
  return html;
}

export function setPersons(targetList: ArrayColl<PersonUID>, personList: { address: string, name: string }[]): void {
  targetList.clear();
  if (!personList?.length) {
    return;
  }
  targetList.addAll(personList.map(p =>
    findOrCreatePersonUID(sanitize.nonemptystring(p.address, "unknown@invalid"), sanitize.label(p.name, null))));
}
