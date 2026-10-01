import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import type { MessageWithReactions } from "../../api/clientApi";
import { IndexedDbMessageStore } from "./IndexedDbMessageStore";
import { MessageSyncEngine } from "./MessageSync";
import { NodeMessageSource, type ChannelBinding } from "./NodeMessageSource";

export { CATCH_UP_PAGE, MAX_CATCH_UP_PAGES } from "./MessageSync";
export type { ChannelCursor } from "./MessageSync";
export type { ChannelBinding } from "./NodeMessageSource";

/**
 * How to reach each channel, learned as they are opened.
 *
 * The engine addresses channels by context id alone; executing a call needs the
 * channel object and, for a DM, an identity. Keeping that here means a
 * component can hand the engine a context id without also threading the calling
 * convention through every layer.
 */
const bindings = new Map<string, ChannelBinding>();

export function bindChannel(binding: ChannelBinding): void {
  bindings.set(binding.contextId, binding);
}

export const messageStore = new IndexedDbMessageStore<MessageWithReactions>();

let engine: MessageSyncEngine<MessageWithReactions> | null = null;

/**
 * One engine for the app, built on first use.
 *
 * Shared deliberately: the cursor is per channel and lives in the store, so a
 * second engine would not hold different state — it would only make it possible
 * for two of them to reconcile the same channel concurrently.
 *
 * Built lazily rather than at module scope because constructing it opens a data
 * source. Doing that as an import side effect makes the app's behaviour depend
 * on module evaluation order, and is what makes a module like this awkward to
 * substitute in a test.
 */
function get(): MessageSyncEngine<MessageWithReactions> {
  if (!engine) {
    engine = new MessageSyncEngine<MessageWithReactions>(
      messageStore,
      new NodeMessageSource(new ClientApiDataSource(), (id) => bindings.get(id)),
    );
  }
  return engine;
}

/**
 * The engine, as a stable reference that builds it on first use.
 *
 * A Proxy rather than an object of hand-written wrappers: a wrapper has to
 * restate each method's parameters, and restating them is how one quietly
 * loses an argument — a two-parameter wrapper around a three-parameter method
 * compiles, runs, and silently drops the third. Forwarding by name cannot
 * drift from what it forwards to.
 */
export const messageSync: MessageSyncEngine<MessageWithReactions> = new Proxy(
  {} as MessageSyncEngine<MessageWithReactions>,
  {
    get(_target, property) {
      const engine = get() as unknown as Record<string | symbol, unknown>;
      const value = engine[property];
      return typeof value === "function" ? value.bind(engine) : value;
    },
  },
);
