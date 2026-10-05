import type { IEvent, IEventCreate, TPartialEvent } from "../types/event";

/**
 * Private events for an ACCOUNT: kept on this device, never sent anywhere.
 *
 * On a node, a private event goes to the contract's `#[app::private]` storage —
 * node-local, never replicated, keyed by the node. An account has no node: its
 * contract calls run on a relay, and a relay has NO private storage for the
 * accounts it serves (core returns a typed error for a delegated run; until it
 * does, every account on the relay would share one bucket, which is the
 * opposite of private). So for an account the only place "private" can mean
 * anything is the device the person is sitting at — this store.
 *
 * Keyed by account + team (namespace): a second account signing in on the same
 * browser sees none of the first one's entries, and one person's teams do not
 * bleed into each other. Each record carries its calendar's `contextId` so a
 * team with several calendars reads back only the one that is open.
 *
 * The node path is unchanged: this module is reached only when
 * `getSession().isDelegated` is true.
 */

const PREFIX = "mc-private-events";

export interface StoredPrivateEvent extends IEvent {
  contextId: string;
}

export function privateStoreKey(accountId: string, namespaceId: string): string {
  return `${PREFIX}:${accountId}:${namespaceId}`;
}

function read(key: string): StoredPrivateEvent[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredPrivateEvent[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, events: StoredPrivateEvent[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(events));
  } catch {
    /* storage full or unavailable — the in-memory list this call returned stands */
  }
}

function newId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `local-${rand}`;
}

/** The private events of one calendar, as the contract would return them. */
export function listPrivateEvents(key: string, contextId: string): IEvent[] {
  return read(key)
    .filter((e) => e.contextId === contextId)
    .map(({ contextId: _ctx, ...event }) => ({ ...event, private: true }));
}

/** Store a new private event and return its id. */
export function addPrivateEvent(
  key: string,
  contextId: string,
  owner: string,
  event: IEventCreate,
): string {
  const id = newId();
  const all = read(key);
  all.push({
    id,
    contextId,
    title: event.title,
    description: event.description,
    start: event.start,
    end: event.end,
    type: event.type,
    color: event.color,
    // A private event has no audience and no node but this one.
    peers: [],
    owner,
    private: true,
  });
  write(key, all);
  return id;
}

/** Merge a patch into a stored event. Returns false when the id is unknown. */
export function updatePrivateEvent(
  key: string,
  eventId: string,
  patch: TPartialEvent,
): boolean {
  const all = read(key);
  const idx = all.findIndex((e) => e.id === eventId);
  if (idx < 0) return false;
  const current = all[idx];
  const next: StoredPrivateEvent = {
    ...current,
    title: patch.title ?? current.title,
    description: patch.description ?? current.description,
    start: patch.start ?? current.start,
    end: patch.end ?? current.end,
    type: patch.type ?? current.type,
    color: patch.color ?? current.color,
    peers: [],
    private: true,
  };
  all[idx] = next;
  write(key, all);
  return true;
}

/** Remove a stored event. Returns false when the id is unknown. */
export function removePrivateEvent(key: string, eventId: string): boolean {
  const all = read(key);
  const kept = all.filter((e) => e.id !== eventId);
  if (kept.length === all.length) return false;
  write(key, kept);
  return true;
}

/** True for an id this store minted — a private event living on this device. */
export function isLocalEventId(id: string): boolean {
  return id.startsWith("local-");
}
