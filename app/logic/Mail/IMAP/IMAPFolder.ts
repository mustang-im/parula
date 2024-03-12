import { Folder, SpecialFolder } from "../Folder";
import { IMAPEMail } from "./IMAPEMail";
import type { IMAPAccount } from "./IMAPAccount";
import { ArrayColl, Collection } from "svelte-collections";

export class IMAPFolder extends Folder {
  account: IMAPAccount;
  path: string;

  constructor(account: IMAPAccount) {
    super(account);
  }

  fromFlow(folderInfo: any) {
    this.name = folderInfo.name;
    this.path = folderInfo.path;
    this.countTotal = folderInfo.status.messages;
    this.countUnread = folderInfo.status.unseen;
    this.countNewArrived = folderInfo.status.recent;
    this.specialUse(folderInfo.specialUse);
  }

  async runCommand(imapFunc: (conn: any) => Promise<void>) {
    let lock;
    try {
      let conn = this.account._connection;
      lock = await conn.getMailboxLock(this.path);
      await imapFunc(conn);
    } finally {
      lock?.release();
    }
  }

  async listMessages() {
    if (this.countTotal === 0) {
      return;
    }
    await this.runCommand(async (conn) => {
      let newMessages = new ArrayColl<IMAPEMail>();
      let msgsAsyncIterator = await conn.fetch({ all: true }, {
        size: true,
        threadId: true,
        internalDate: true,
        envelope: true,
        flags: true,
      });
      for await (let msgInfo of msgsAsyncIterator) {
        let msg = this.getEMailByUID(msgInfo.uid);
        if (!msg) {
          msg = new IMAPEMail(this);
          msg.fromFlow(msgInfo);
          newMessages.add(msg);
        }
      }
      this.messages.addAll(newMessages); // notify only once
    });
    await this.downloadMessagesComplete();
  }

  async downloadMessagesComplete() {
    await this.runCommand(async (conn) => {
      let newMessages = new ArrayColl<IMAPEMail>();
      for await (let msgInfo of await conn.fetch({ all: true }, {
        size: true,
        threadId: true,
        envelope: true,
        source: true,
        flags: true,
        // headers: true,
      })) {
        let msg = this.getEMailByUID(msgInfo.uid);
        if (msg?.downloadComplete) {
          continue;
        } else if (msg) {
          msg.fromFlow(msgInfo);
          msg.downloadComplete = true;
          await msg.parseMIME();
        } else {
          msg = new IMAPEMail(this);
          msg.fromFlow(msgInfo);
          msg.downloadComplete = true;
          await msg.parseMIME();
          newMessages.add(msg);
        }
      }
      this.messages.addAll(newMessages); // notify only once
    });
  }

  getEMailByUID(uid: number): IMAPEMail {
    return this.messages.find((m: IMAPEMail) => m.uid == uid) as IMAPEMail;
  }

  /* getEMailByUIDOrCreate(uid: number): IMAPEMail {
    return this.getEMailByUID(uid) ?? new IMAPEMail(this);
  }*/


  async moveMessagesHere(messages: Collection<IMAPEMail>) {
    super.moveMessagesHere(messages);
    alert("Messages moved");
  }

  async copyMessagesHere(messages: Collection<IMAPEMail>) {
    super.copyMessagesHere(messages);
    alert("Messages copied");
  }

  async moveFolderHere(folder: Folder) {
    super.moveFolderHere(folder);
    alert("Folder moved");
  }

  async createSubFolder(name: string) {
    let folder = new IMAPFolder(this.account);
    folder.name = name;
    folder.parent = this;
    this.subFolders.add(folder);
    alert("Folder created");
  }

  specialUse(specialUse: string): void {
    switch (specialUse) {
      case "\Inbox":
        this.account.inbox = this;
        this.specialFolder = SpecialFolder.Inbox;
        break;
      case "\Trash":
        this.account.trash = this;
        this.specialFolder = SpecialFolder.Trash;
        break;
      case "\Junk":
        this.account.spam = this;
        this.specialFolder = SpecialFolder.Spam;
        break;
      case "\Sent":
        this.account.sent = this;
        this.specialFolder = SpecialFolder.Sent;
        break;
      case "\Drafts":
        this.account.drafts = this;
        this.specialFolder = SpecialFolder.Drafts;
        break;
      case "\Archive":
        this.account.archive = this;
        this.specialFolder = SpecialFolder.Archive;
        break;
    }
  }
}
