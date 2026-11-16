import type { GroupContextChannel } from "../types/Common";
import { GENERAL_CHANNEL } from "./createChannel";

// Entering a workspace (creating it, joining it from an invitation, picking
// it) opens #general, so nobody lands on an empty screen. The wish is kept
// for this tab until the channel list has it.

const LAND_KEY = "chat:land-in-general";

/** Open #general once the workspace's channels have loaded. */
export function landInGeneral(storage: Pick<Storage, "setItem"> = sessionStorage): void {
  try {
    storage.setItem(LAND_KEY, "1");
  } catch {
    /* the workspace still opens, on whatever it shows first */
  }
}

export function wantsGeneral(storage: Pick<Storage, "getItem"> = sessionStorage): boolean {
  try {
    return storage.getItem(LAND_KEY) === "1";
  } catch {
    return false;
  }
}

export function landed(storage: Pick<Storage, "removeItem"> = sessionStorage): void {
  try {
    storage.removeItem(LAND_KEY);
  } catch {
    /* nothing kept */
  }
}

/** #general among `channels`, once it is joined and can be opened. */
export function generalChannel(channels: GroupContextChannel[]): GroupContextChannel | undefined {
  return channels.find(
    (ch) =>
      ch.isJoined &&
      Boolean(ch.contextIdentity) &&
      (ch.info?.name ?? ch.alias ?? "").trim().toLowerCase() === GENERAL_CHANNEL,
  );
}
