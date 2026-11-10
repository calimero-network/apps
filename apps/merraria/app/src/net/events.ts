// The app's events, as `client.events(app, from)` yields them: `{ id, kind,
// data }`. Every field of an app event is named (core D63), so `data` is
// `{ "account": <account> }` (`TilesChanged`, `PlayerJoined`, `PlayerLeft`) or
// nothing (`Initialized`). An event is a nudge to re-read state, never the state.

export interface GameEvent {
  kind: string;
  /** the account the event names, when it names one */
  value: string | null;
}

export function toGameEvent(event: { kind: string; data: unknown }): GameEvent {
  const data = event.data;
  const account =
    data !== null && typeof data === "object" ? (data as Record<string, unknown>).account : undefined;
  return { kind: event.kind, value: typeof account === "string" ? account : null };
}

/**
 * The log index an event id carries. Event ids start with the index of the
 * entry that emitted them (`"<index>:<seq>"`); anything else
 * gives null, and the stream is then resumed from the last index known.
 */
export function indexOf(id: string): number | null {
  const m = /^(\d+)/.exec(id);
  return m ? Number(m[1]) : null;
}
