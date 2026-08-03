import { useCallback, useMemo } from "react";
import { useExecute } from "@calimero-network/mero-react";
import {
  getContextId,
  getExecutorPublicKey,
  nowMillis,
  nowSecs,
} from "../lib/session";
import type { DecodedFrame, Member, StreamStats } from "../types";

/**
 * Typed wrapper over the Mero Stream contract RPC (mirrors mero-meet's
 * useMeroMeet). Every mutating method passes `now` (unix seconds) since the WASM
 * contract has no wall clock.
 *
 * The Task-3 core is `encodeFrame`: `raw` is the downscaled luma buffer (a plain
 * number[] of 0-255 bytes, `width * height` long). It is a MUTATION ARGUMENT, so
 * it stays local to the executing node — only the compressed fragment the
 * contract produces enters the replicated delta and gossips.
 */
export function useMeroStream() {
  const contextId = getContextId();
  const executorId = getExecutorPublicKey();
  const { execute, loading, error } = useExecute(contextId, executorId);

  const join = useCallback(
    (username: string) => execute<Member>("join", { username, now: nowSecs() }),
    [execute],
  );

  const getMembers = useCallback(
    () => execute<Member[]>("get_members", {}),
    [execute],
  );

  const encodeFrame = useCallback(
    (
      raw: number[] | Uint8Array,
      width: number,
      height: number,
      track: number,
    ) =>
      // The contract signature is encode_frame(raw, width, height, track, now).
      // Pass `raw` as a plain array so it serializes to a JSON byte list.
      //
      // `now` is MILLISECONDS here, unlike every other method's `nowSecs()`.
      // Fragments are the one thing whose timestamp gets subtracted from a
      // receiver's clock (§4 end-to-end latency), and that measurement is
      // meaningless quantized to whole seconds. See lib/session.ts#nowMillis.
      execute<number>("encode_frame", {
        raw: Array.from(raw),
        width,
        height,
        track,
        now: nowMillis(),
      }),
    [execute],
  );

  const getFrame = useCallback(
    (afterSeq: number) =>
      execute<DecodedFrame[]>("get_frame", { after_seq: afterSeq }),
    [execute],
  );

  const pruneFrames = useCallback(
    (beforeSeq: number) => execute("prune_frames", { before_seq: beforeSeq }),
    [execute],
  );

  const getStats = useCallback(
    () => execute<StreamStats>("get_stats", {}),
    [execute],
  );

  const renameStream = useCallback(
    (name: string) => execute("rename_stream", { name }),
    [execute],
  );

  return useMemo(
    () => ({
      contextId,
      executorId,
      loading,
      error,
      join,
      getMembers,
      encodeFrame,
      getFrame,
      pruneFrames,
      getStats,
      renameStream,
    }),
    // `loading`/`error` are deliberately NOT deps: they flip on every request,
    // and having them here would change this object's identity each time —
    // tearing down and rebuilding every consumer effect keyed on the returned
    // object (the capture interval + SSE drain in useStream). The identity now
    // only changes when `execute` genuinely changes (provider became ready /
    // session moved), at the cost of the (unused) loading/error fields going
    // stale on the object. Same discipline as mero-meet's useMeroMeet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      contextId,
      executorId,
      join,
      getMembers,
      encodeFrame,
      getFrame,
      pruneFrames,
      getStats,
      renameStream,
    ],
  );
}
