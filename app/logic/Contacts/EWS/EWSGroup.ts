import { Group } from '../../Abstract/Group';
import { Person, ContactEntry } from '../../Abstract/Person';
import { findPerson } from '../../Abstract/PersonUID';
import type { EWSAddressbook } from './EWSAddressbook';
import EWSCreateItemRequest from "../../Mail/EWS/EWSCreateItemRequest";
import EWSDeleteItemRequest from "../../Mail/EWS/EWSDeleteItemRequest";
import EWSUpdateItemRequest from "../../Mail/EWS/EWSUpdateItemRequest";
import { appGlobal } from "../../app";
import { ensureArray } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export class EWSGroup extends Group {
  addressbook: EWSAddressbook | null;

  get itemID() {
    return this.id;
  }
  set itemID(val) {
    this.id = val;
  }

  fromXML(xmljs: any) {
    this.itemID = sanitize.nonemptystring(xmljs.ItemId.Id);
    this.name = sanitize.nonemptystring(xmljs.DisplayName, "");
    this.description = sanitize.nonemptystring(xmljs.Body?.Value, "");
    if (xmljs.Members?.Member) {
      // `replaceAll` doesn't work for a `SetColl`
      this.participants.clear();
      this.participants.addAll(ensureArray(xmljs.Members.Member).map(member => findOrCreatePerson(sanitize.emailAddress(member.Mailbox.EmailAddress), sanitize.nonemptystring(member.Mailbox.Name, null))));
    }
  }

  async save() {
    // XXX untested due to no UI yet
    let request = this.itemID ? new EWSUpdateItemRequest(this.itemID) : new EWSCreateItemRequest();
    request.addField("DistributionList", "Body", this.description && { BodyType: "Text", _TextContent_: this.description }, "item:Body");
    request.addField("DistributionList", "DisplayName", this.name, "contacts:DisplayName");
    let participants = this.participants.contents.filter(entry => entry.emailAddresses.first?.value);
    request.addField("DistributionList", "Members", participants.length ? {
      t$Member: participants.map(entry => ({
        t$Mailbox: {
         t$EmailAddress: entry.emailAddresses.first.value,
         t$Name: entry.name,
        },
      })),
    } : "", "distributionlist:Members");
    let response = await this.addressbook.account.callEWS(request);
    this.itemID = sanitize.nonemptystring(response.Items.DistributionList.ItemId.Id);
    await super.save();
  }

  async deleteIt() {
    let request = new EWSDeleteItemRequest(this.itemID);
    await this.addressbook.account.callEWS(request);
    await super.deleteIt();
  }
}

function findOrCreatePerson(emailAddress: string, name:string): Person {
  let person = findPerson(emailAddress);
  if (person) {
    return person;
  }
  person = new Person(appGlobal.collectedAddressbook);
  person.name = name;
  person.emailAddresses.add(new ContactEntry(emailAddress, null, "mailto"));
  return person;
}
