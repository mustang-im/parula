import { Message } from "../Abstract/Message";
import type { Chat } from "./Chat";
import type { ChatPerson } from "./Person";
import { MapColl } from "svelte-collections";

export class ChatMessage extends Message {
  to: Chat;
  deliveryStatus = DeliveryStatus.Unknown;
}

/**
 * A human-language message from a human to other humans.
 */
export class UserChatMessage extends ChatMessage {
}

export enum DeliveryStatus {
  Unknown = "unknown",
  Sending = "sending",
  Server = "server",
  User = "user",
  Seen = "seen",
}
