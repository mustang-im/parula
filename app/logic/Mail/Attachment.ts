import { appGlobal } from "../app";
import { Observable, notifyChangedProperty } from "../util/Observable";
import { saveURLAsFile } from "../../frontend/Util/util";
import { NotImplemented } from "../util/util";

export class Attachment extends Observable {
  /** filename with extension, as given by the sender of the email */
  @notifyChangedProperty
  filename: string;
  /** Where the attachment is stored on the user's local disk, after download */
  @notifyChangedProperty
  filepathLocal: string;
  @notifyChangedProperty
  mimeType: string;
  /** File size, in bytes
   * null, if the attachment wasn't downloaded yet. */
  @notifyChangedProperty
  size: number | null;
  @notifyChangedProperty
  disposition = ContentDisposition.unknown;
  /** embedded image */
  @notifyChangedProperty
  related: boolean;
  @notifyChangedProperty
  contentID: string;
  /** File contents. Not populated, if we have the attachment saved on disk */
  @notifyChangedProperty
  content: File;

  static fromFile(file: File): Attachment {
    let attachment = new Attachment();
    attachment.content = file;
    attachment.filename = file.name;
    attachment.mimeType = file.type;
    attachment.size = file.size;
    attachment.disposition = ContentDisposition.attachment;
    return attachment;
  }

  clone(): Attachment {
    let clone = new Attachment();
    Object.assign(clone, this);
    if (this.content) {
      clone.content = new File([this.content], this.content.name);
    }
    return clone;
  }

  /** Open the native desktop app with this file */
  async openOSApp() {
    await appGlobal.remoteApp.openFileInNativeApp(this.filepathLocal);
  }
  /** Open the native file manager with the folder
   * where this file is, and select this file. */
  async openOSFolder() {
    await appGlobal.remoteApp.showFileInFolder(this.filepathLocal);
  }
  async saveFile() {
    throw new NotImplemented();
    let url = "file://" + this.filepathLocal;
    console.log("url " + url);
    saveURLAsFile(url, this.filename);
  }
  async deleteFile() {
    throw new NotImplemented();
  }
}

export enum ContentDisposition {
  unknown = "unknown",
  inline = "inline",
  attachment = "attachment",
}
