import { writable } from "svelte/store";

export enum AppArea {
  Mail = 1,
  Chat = 2,
  Contacts = 3,
  Calendar = 4,
  Meet = 5,
  Apps = 6,
}

export const selectedApp = writable(AppArea.Mail);