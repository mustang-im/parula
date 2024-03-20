import { AuthMethod, MailAccount, TLSSocketType } from "../../../../logic/Mail/MailAccount";
import { newAccountForProtocol } from "../../../../logic/Mail/MailAccounts";
import JXON from "../../../../../lib/util/JXON";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../../../logic/util/util";
import { ArrayColl } from "svelte-collections";

export function readConfigFromXML(autoconfigXMLStr: string, forDomain: string): ArrayColl<MailAccount> {
  let autoconfigXML = JXON.parse(autoconfigXMLStr);
  if (typeof (autoconfigXML) != "object" ||
    !autoconfigXML?.clientConfig?.emailProvider) {
    console.log("autoconfig xml", JSON.stringify(autoconfigXML, null, 2), autoconfigXML);
    throw new Error("Config syntax error");
  }
  let xml = autoconfigXML.clientConfig.emailProvider;

  let configs = new ArrayColl<MailAccount>();

  let displayName = xml.displayName ? sanitize.label(xml.displayName) : sanitize.hostname(xml["@id"]);
  //let domains = xml.$domain.map(domain => sanitize.hostname(domain));
  assert(ensureArray(xml.$domain).includes(forDomain), "Need proper <domain> in XML");
  let firstError: Error;

  // Incoming server
  for (let iX of ensureArray(xml.$incomingServer)) {
    try {
      configs.push(readServer(iX, displayName));
    } catch (ex) {
      firstError = ex;
    }
  }
  if (!configs.length) {
    throw firstError ?? new Error("No working <incomingServer> in autoconfig XML found");
  }
  firstError = null;

  // Outgoing server
  for (let oX of ensureArray(xml.$outgoingServer)) {
    try {
      configs.push(readServer(oX, displayName));
    } catch (ex) {
      firstError = ex;
    }
  }
  if (!configs.length) {
    throw firstError ?? new Error("No working <outgoingServer> in autoconfig XML found");
  }

  return configs;
}

/**
 * @param {JXON} xml <incomingServer> or <outgoingServer>
 */
function readServer(xml: any, displayName: string): MailAccount {
  let protocol = sanitize.enum(xml["@type"], ["pop3", "imap", "jmap", "smtp", "exchange"], null);
  assert(protocol, "Need type for <incomingServer>");
  let account = newAccountForProtocol(protocol);

  account.name = displayName;
  account.hostname = sanitize.hostname(xml.hostname);
  account.port = sanitize.portTCP(xml.port);
  account.username = sanitize.string(xml.username); // may be a %VARIABLE%
  if (xml.password) {
    account.password = sanitize.string(xml.password);
  }

  // Take first supported
  account.tls = ensureArray(xml.$socketType).find(socketType => sanitize.translate(socketType, {
    plain: TLSSocketType.Plain,
    SSL: TLSSocketType.TLS,
    STARTTLS: TLSSocketType.STARTTLS
  }, null));
  assert(account.tls, "No supported <socketType> in autoconfig");

  // Take first supported auth method
  account.authMethod = ensureArray(xml.$authentication).find(auth => sanitize.translate(auth, {
    "password-cleartext": AuthMethod.Password,
    "OAuth2": AuthMethod.OAuth2,
    "password-encrypted": AuthMethod.CRAMMD5,
    "GSSAPI": AuthMethod.GSSAPI,
    "NTLM": AuthMethod.NTLM,
  }, null));
  assert(account.authMethod, "No supported <authentication> method in autoconfig");
  return account;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}
