import type { Account } from "../../Abstract/Account";

export class ActiveSyncError extends Error {
  type: string;
  code: string;
  constructor(aCommand: string, aStatus: string, account: Account) {
    let msg = globalMessages[aStatus] || messages[aCommand]?.[aStatus] || `ActiveSync ${aCommand} status ${aStatus}`;
    if (account) {
      msg = account.name + ": " + msg;
    }
    super(msg);
    this.type = aCommand;
    this.code = aStatus;
  }
}

const globalMessages: Record<number, string> = {
  101: "Invalid content",
  102: "Invalid WBXML",
  103: "Invalid XML",
  104: "Invalid Date/Time",
  105: "Invalid combination of IDs",
  106: "Invalid IDs",
  107: "Invalid MIME",
  108: "Missing or invalid device ID",
  109: "Missing or invalid device type",
  110: "Server error",
  111: "Retryable server error",
  112: "Active directory access deined",
  113: "Mailbox quota exceeded",
  114: "Mailbox server offline",
  115: "Send quota exceeded",
  116: "Unresolved message recipient",
  117: "Message reply not allowed",
  118: "Message was previously sent",
  119: "Message has no recipient",
  120: "Mail submission failed",
  121: "Message reply failed",
  122: "Attachment is too large",
  123: "User has no mailbox",
  124: "User cannot be anonymous",
  125: "User not found",
  126: "ActiveSync is disabled for this user",
  127: "ActiveSync is disabled for this server",
  128: "ActiveSync is disabled for this legacy server",
  129: "ActiveSync is blocked for this application",
  130: "Access is denied",
  131: "User account is disabled",
  132: "Server sync state not found",
  133: "Server sync state locked",
  134: "Server sync state corrupt",
  135: "Server sync state already exists",
  136: "Server sync state version invalid",
  137: "Command not supported",
  138: "Version not supported",
  139: "Application not fully provisionable",
  140: "Remote wipe requested",
  141: "Application on strict policy",
  142: "Application not provisioned",
  143: "Policy refresh required",
  144: "Policy key invalid",
  145: "Applcation not allowed",
  146: "No such occurrence in calendar",
  147: "Unexpected item class",
  148: "Back end server requires SSL",
  149: "Stored request no longer valid",
  150: "Item not found",
  151: "Too many folders in mailbox",
  152: "No folders in mailbox",
  153: "Items lost after move",
  154: "Failure in move operation",
  155: "Move command requires Move Always",
  156: "Invalid destination for move",
  160: "Too many recipients",
  161: "Distribution list limit reached",
  162: "Transient failure in availability service",
  163: "Failure in availability service",
  164: "Unsupported body type preference",
  165: "Missing application information",
  166: "Invalid account ID",
  167: "Sending from this account is disabled",
  168: "IRM is disabled",
  169: "Transient IRM error",
  170: "IRM error",
  171: "Invalid IRM template ID",
  172: "IRM operation not permitted",
  173: "No picture for user",
  174: "Picture too large",
  175: "Picture limit reached",
  176: "Conversation too large to compute body",
  177: "Too many ActiveSync clients",
};

const messages: Record<string, Record<number, string>> = {
  FolderCreate: {
    2: "Folder already exists",
    3: "Invalid parent folder",
    5: "Parent folder not found",
    6: "Transient server error",
    7: "Sync key invalid",
    10: "Malformed request",
    11: "Unknown error",
    12: "Unusual back-end issue",
  },
  FolderDelete: {
    3: "Cannot delete special folders",
    4: "Folder not found",
    6: "Transient server error",
    9: "Sync key invalid",
    10: "Malformed request",
    11: "Unknown error",
  },
  FolderSync: {
    6: "Transient server error",
    9: "Sync key invalid",
    10: "Malformed request",
    11: "Unknown error",
    12: "Unusual back-end issue",
  },
  FolderUpdate: {
    2: "Folder already exists",
    3: "Invalid folder",
    4: "Folder does not exist",
    5: "Parent folder not found",
    6: "Transient server error",
    9: "Sync key invalid",
    10: "Malformed request",
    11: "Unknown error",
  },
  ItemOperations: {
    2: "XML validation error",
    3: "Server error",
    14: "Unable to convert mailbox item",
    16: "Access denied",
    18: "Credentials required",
  },
  MeetingResponse: {
    2: "Invalid meeting request",
    3: "Temporary mailbox error",
    4: "Temporary server error",
  },
  MoveItems: {
    1: "Invalid source folder",
    2: "Invalid destination folder",
    4: "Cannot move from folder to itself",
    5: "Cannot move to multiple folders",
    7: "Item temporarily locked",
  },
  Ping: {
    1: "Heartbeat interval expired",
    2: "Changes occurred",
    3: "Missing parameter",
    4: "Malformed request",
    5: "Invalid heartbeat interval",
    6: "Too many folders",
    7: "Folder hierarchy resync required",
    8: "Temporary server error",
  },
  Provision: {
    2: "Protocol error",
    3: "Server error",
  },
  Settings: {
    2: "Protocol error",
    3: "Access is deined",
    4: "Server unavailable",
    5: "Invalid parameters",
    6: "Conflicting parameters",
    7: "Denied by policy",
  },
  Sync: {
    3: "Sync key invalid",
    4: "Protocol error",
    5: "Temporary server error",
    6: "Malformed request",
    7: "Conflicting change on server",
    8: "Item not found",
    9: "Out of disk space",
    12: "Folder hierarchy changed",
    13: "Incomplete request",
    14: "Invalid Wait/Heartbeat interval",
    15: "Too many collections",
    16: "Retryable error",
  },
};
