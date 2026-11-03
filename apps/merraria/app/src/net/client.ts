// GameClient: the world's methods and its event stream, over mero-js's
// CalimeroClient (merod local in dev, a Calimero Cloud cluster in production).

import type { CalimeroClient } from "@calimero-network/mero-js";

import { indexOf, toGameEvent, type GameEvent } from "./events";
import { bindExec, merraria, type Exec, type WorldMeta } from "./merraria";

export type { WorldMeta } from "./merraria";

/** How long to wait before re-opening a dropped event stream. */
export const RECONNECT_MS = 1_000;

type Client = Pick<CalimeroClient, "call" | "view" | "events">;

export class GameClient {
  /** The highest log index any answer or event has shown: where a stream resumes. */
  private index = 0;
  private abort: AbortController | null = null;
  readonly exec: Exec;

  constructor(
    private readonly client: Client,
    /** the app instance: the world */
    readonly worldId: string,
    /** the signed-in account: how the contract names this player */
    private readonly accountId: string,
    after: () => void = () => {},
  ) {
    this.exec = bindExec(client, worldId, after, (i) => this.seen(i));
  }

  private seen(index: number): void {
    if (Number.isFinite(index) && index > this.index) this.index = index;
  }

  /** Me as the contract sees me: `getPlayers` ids and event payloads are accounts. */
  async resolveIdentity(): Promise<string | null> {
    return this.accountId;
  }

  fetchWorldMeta(): Promise<WorldMeta> {
    return merraria(this.exec).worldMeta();
  }

  /**
   * Streams the world's events from just after the last state read, so
   * nothing between that read and the subscription is missed. A dropped stream
   * is re-opened from the last index seen; `onReconnect` then runs, so the
   * caller can re-read whatever it polls anyway.
   */
  async subscribe(onEvent: (ev: GameEvent) => void, onReconnect?: () => void): Promise<void> {
    this.close();
    const abort = new AbortController();
    this.abort = abort;
    void (async () => {
      let first = true;
      while (!abort.signal.aborted) {
        try {
          if (!first) onReconnect?.();
          first = false;
          for await (const event of this.client.events(this.worldId, this.index + 1, abort.signal)) {
            const i = indexOf(event.id);
            if (i !== null) this.seen(i);
            onEvent(toGameEvent(event));
          }
        } catch {
          // Closed (network, node restart, sign-out): polling covers the gap,
          // and the loop re-opens from the last index seen.
        }
        if (abort.signal.aborted) return;
        await new Promise((r) => setTimeout(r, RECONNECT_MS));
      }
    })();
  }

  close(): void {
    this.abort?.abort();
    this.abort = null;
  }
}
