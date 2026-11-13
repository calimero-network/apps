import { useCallback, useMemo, useState } from "react";
import { describeError } from "@calimero-apps/connect";
import { useSessionApi } from "../session";
import { MeroStreamClient } from "../generated/client";
import {
  num,
  toBase64Url,
  toChunks,
  toCursors,
  toFrames,
  toLiveStats,
  toMember,
  toMembers,
  toStats,
  u64,
  wireCursors,
  type ChunkInput,
} from "../lib/meroStream";
import { getContextId, nowMillis, nowSecs } from "../lib/session";
import type { SenderCursor } from "../types";

/**
 * The contract of the active room, for the screens.
 *
 * v1 wrapped mero-react's `useExecute`; this calls `MeroStreamClient`, which
 * `meroctl app codegen` writes from logic/res/abi.json, and turns its
 * answers back into the shapes the screens were written against
 * (`lib/meroStream`'s `to*`). The API is the one the pages
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
    () => (client && contextId ? new MeroStreamClient(client, contextId, { after }) : null),
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
      join: (username: string) => soft(async (c) => toMember(await c.join({ username, now: u64(nowSecs()) }))),
      getMembers: () => soft(async (c) => toMembers(await c.getMembers())),
      encodeFrame: (
        raw: number[] | Uint8Array,
        width: number,
        height: number,
        track: number,
      ) =>
        hard(async (c) =>
          num(await c.encodeFrame({ raw: toBase64Url(raw), width, height, track, now: u64(nowMillis()) })),
        ),
      getFrame: (afterSeq: number) => soft(async (c) => toFrames(await c.getFrame({ afterSeq: u64(afterSeq) }))),
      pruneFrames: (beforeSeq: number) =>
        soft(async (c) => {
          await c.pruneFrames({ beforeSeq: u64(beforeSeq) });
        }),
      getStats: () => soft(async (c) => toStats(await c.getStats())),
      renameStream: (name: string) =>
        soft(async (c) => {
          await c.renameStream({ name });
        }),
      postChunk: (chunk: ChunkInput) =>
        hard(async (c) =>
          num(
            await c.postChunk({
              dataB64: chunk.dataB64,
              track: chunk.track,
              isKeyframe: chunk.isKeyframe,
              codec: chunk.codec,
              width: chunk.width,
              height: chunk.height,
              timestampUs: u64(chunk.timestampUs),
              now: u64(nowMillis()),
            }),
          ),
        ),
      getChunks: (cursors: SenderCursor[]) =>
        soft(async (c) => toChunks(await c.getChunks({ cursors: wireCursors(cursors) }))),
      keyframeCursors: () => soft(async (c) => toCursors(await c.keyframeCursors())),
      getLiveStats: () => soft(async (c) => toLiveStats(await c.getLiveStats())),
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
