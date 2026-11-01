// GameClient: the world's contract calls and its event stream, for the world
// the player entered, over mero-js's `CalimeroClient`.

import type { CalimeroClient, CloudEvent } from "@calimero-network/mero-js";
import { LoginRequired } from "@calimero-network/mero-js";

import { blocks, type Blocks } from "./blocks";
import type { GameEvent } from "./sync";

/** How long to wait before re-opening a dropped event stream. */
const RECONNECT_MS = 1500;

export interface GameClientOptions {
  /** Runs after every request (keeps the stored session current). */
  after?: () => void;
  /** The stream answered "sign in again": the session is gone. */
  onSignedOut?: () => void;
}

export class GameClient {
  readonly api: Blocks;
  private abort: AbortController | null = null;

  constructor(
    private readonly client: Pick<CalimeroClient, "call" | "view" | "events">,
    readonly appId: string,
    device: string,
    private readonly options: GameClientOptions = {},
  ) {
    this.api = blocks(client, appId, device, options.after);
  }

  /**
   * Follow the world's events from log index `from` (the index the world was
   * first read at, so nothing before it is replayed). A dropped stream (the
   * node restarted, the machine slept) is re-opened after a pause from the
   * event after the last one seen; `onReconnect` runs then, so the caller can
   * re-read the world, as blocks are otherwise only pulled on an event.
   */
  subscribe(from: number, onEvent: (ev: GameEvent) => void, onReconnect?: () => void): void {
    this.close();
    const abort = new AbortController();
    this.abort = abort;
    let next = from;
    void (async () => {
      let first = true;
      while (!abort.signal.aborted) {
        if (!first) onReconnect?.();
        first = false;
        try {
          for await (const event of this.client.events(this.appId, next, abort.signal) as AsyncGenerator<CloudEvent>) {
            const index = Number.parseInt(event.id, 10);
            if (Number.isFinite(index)) next = index + 1;
            onEvent({ kind: event.kind, value: event.data });
          }
        } catch (err) {
          if (abort.signal.aborted) return;
          if (err instanceof LoginRequired) {
            this.options.onSignedOut?.();
            return;
          }
        } finally {
          this.options.after?.();
        }
        if (abort.signal.aborted) return;
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
      }
    })();
  }

  close(): void {
    this.abort?.abort();
    this.abort = null;
  }
}
