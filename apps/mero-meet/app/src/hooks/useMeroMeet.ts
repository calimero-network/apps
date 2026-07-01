import { useCallback, useMemo } from "react";
import { useExecute } from "@calimero-network/mero-react";
import { getContextId, getExecutorPublicKey, nowSecs } from "../lib/session";
import type { ChatMessage, LobbyView, Signal } from "../types";

/**
 * Typed wrapper over the mero-meet contract RPC. Every mutating method passes
 * `now` (unix seconds) since the WASM contract has no wall clock.
 */
export function useMeroMeet() {
  const contextId = getContextId();
  const executorId = getExecutorPublicKey();
  const { execute, loading, error } = useExecute(contextId, executorId);

  const join = useCallback(
    (username: string) => execute("join", { username, now: nowSecs() }),
    [execute],
  );

  const heartbeat = useCallback(
    () => execute("heartbeat", { now: nowSecs() }),
    [execute],
  );

  const setState = useCallback(
    (state: { muted?: boolean; video_on?: boolean; status?: string }) =>
      execute("set_state", {
        muted: state.muted ?? null,
        video_on: state.video_on ?? null,
        status: state.status ?? null,
        now: nowSecs(),
      }),
    [execute],
  );

  const leave = useCallback(
    () => execute("leave", { now: nowSecs() }),
    [execute],
  );

  const getLobby = useCallback(
    () => execute<LobbyView>("get_lobby", { now: nowSecs() }),
    [execute],
  );

  const startCall = useCallback(
    () => execute<string>("start_call", { now: nowSecs() }),
    [execute],
  );

  const leaveCall = useCallback(
    () => execute("leave_call", { now: nowSecs() }),
    [execute],
  );

  const endCall = useCallback(() => execute("end_call", {}), [execute]);

  const getCallParticipants = useCallback(
    () => execute<string[]>("get_call_participants", {}),
    [execute],
  );

  const postSignal = useCallback(
    (to: string, kind: string, payload: string, callId: string) =>
      execute<number>("post_signal", {
        to,
        kind,
        payload,
        call_id: callId,
        now: nowSecs(),
      }),
    [execute],
  );

  const getSignals = useCallback(
    (afterSeq: number) => execute<Signal[]>("get_signals", { after_seq: afterSeq }),
    [execute],
  );

  const postMessage = useCallback(
    (text: string) => execute<number>("post_message", { text, now: nowSecs() }),
    [execute],
  );

  const getMessages = useCallback(
    (afterSeq: number) => execute<ChatMessage[]>("get_messages", { after_seq: afterSeq }),
    [execute],
  );

  return useMemo(
    () => ({
      contextId,
      executorId,
      loading,
      error,
      join,
      heartbeat,
      setState,
      leave,
      getLobby,
      startCall,
      leaveCall,
      endCall,
      getCallParticipants,
      postSignal,
      getSignals,
      postMessage,
      getMessages,
    }),
    [
      contextId,
      executorId,
      loading,
      error,
      join,
      heartbeat,
      setState,
      leave,
      getLobby,
      startCall,
      leaveCall,
      endCall,
      getCallParticipants,
      postSignal,
      getSignals,
      postMessage,
      getMessages,
    ],
  );
}
