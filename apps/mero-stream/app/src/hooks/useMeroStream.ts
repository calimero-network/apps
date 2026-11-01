import { useCallback, useMemo, useState } from "react";
import { describeError } from "@calimero-apps/connect";
import { useSessionApi } from "../session";
import { meroStream, type ChunkInput } from "../lib/meroStream";
import { getContextId, nowMillis, nowSecs } from "../lib/session";
import type { SenderCursor } from "../types";

/**
 * The contract of the active room, for the screens.
 *
 * v1 wrapped mero-react's `useExecute`; this wraps mero-js's `CalimeroClient`
 * through `lib/meroStream` (which turns the component's wire shapes back into
 * the ones the screens were written against). The API is the one the pages
 * already used:
 *
 * - `contextId` is the room's app id (v1: its context id);
 * - `executorId` and `myId` are both the signed-in ACCOUNT. v1 had two ids
 *   (the executor writes went out as, and the device key the contract
 *   recorded); on the component runtime the contract records the caller's
 *   account, which is also who presence names;
 * - reads and `join` resolve to `null` on a refusal (v1's `useExecute` did the
 *   same, and the pages rely on it), with the message in `error`;
 * - `encodeFrame` and `postChunk` reject, because the probe times them and
 *   counts a refusal as a failed encode.
 */
export function useMeroStream() {
  const { session, store } = useSessionApi();
  const client = session.status === "signed-in" ? session.client : null;
  const accountId = session.status === "signed-in" ? session.accountId : null;
  const contextId = getContextId();
  const [error, setError] = useState<string | null>(null);

  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  const api = useMemo(
    () => (client && contextId ? meroStream(client, contextId, after) : null),
    [client, contextId, after],
  );

  /** Run `fn` against the room; `null` (and `error` set) when it is refused. */
  const soft = useCallback(
    async <T>(fn: (c: NonNullable<typeof api>) => Promise<T>): Promise<T | null> => {
      if (!api) return null;
      try {
        const out = await fn(api);
        setError(null);
        return out;
      } catch (e) {
        setError(describeError(e));
        return null;
      }
    },
    [api],
  );

  const hard = useCallback(
    <T>(fn: (c: NonNullable<typeof api>) => Promise<T>): Promise<T> => {
      if (!api) return Promise.reject(new Error("not signed in to a room"));
      return fn(api);
    },
    [api],
  );

  return useMemo(
    () => ({
      contextId,
      executorId: accountId,
      myId: accountId,
      loading: false,
      error,
      join: (username: string) => soft((c) => c.join(username, nowSecs())),
      getMembers: () => soft((c) => c.getMembers()),
      encodeFrame: (
        raw: number[] | Uint8Array,
        width: number,
        height: number,
        track: number,
      ) => hard((c) => c.encodeFrame(raw, width, height, track, nowMillis())),
      getFrame: (afterSeq: number) => soft((c) => c.getFrame(afterSeq)),
      pruneFrames: (beforeSeq: number) => soft((c) => c.pruneFrames(beforeSeq)),
      getStats: () => soft((c) => c.getStats()),
      renameStream: (name: string) => soft((c) => c.renameStream(name)),
      postChunk: (chunk: ChunkInput) => hard((c) => c.postChunk(chunk, nowMillis())),
      getChunks: (cursors: SenderCursor[]) => soft((c) => c.getChunks(cursors)),
      keyframeCursors: () => soft((c) => c.keyframeCursors()),
      getLiveStats: () => soft((c) => c.getLiveStats()),
    }),
    // `error` is deliberately not a dep: it flips on every refusal, and a new
    // object identity would tear down every effect keyed on this one (the
    // capture interval and the event drain).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contextId, accountId, soft, hard],
  );
}

/** The signed-in client, for the hooks that use more than the contract (events, presence). */
export function useClient() {
  const { session, store } = useSessionApi();
  const client = session.status === "signed-in" ? session.client : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);
  return { client, after };
}
