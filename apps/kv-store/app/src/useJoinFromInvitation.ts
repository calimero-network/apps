import { useCallback, useEffect, useRef, useState } from "react";
import { useDeepLink } from "@calimero-network/mero-platform-react";
import type { DeepLinkIntent } from "@calimero-network/mero-platform";
import {
  setContextId,
  useJoinContext,
  useJoinNamespace,
  useMero,
} from "@calimero-network/mero-react";
import {
  decodeInvitationPayload,
  isTerminalInvitationError,
  parseInvitationPayload,
  type KvInvitationPayload,
} from "./utils/invitation";

export type JoinState =
  | { status: "idle" }
  | { status: "joining"; payload: KvInvitationPayload }
  | { status: "failed"; message: string; retryable: boolean };

/**
 * Redeem a pending invitation, whenever one arrives and the session is ready.
 *
 * Two ordering facts shape this:
 *
 *  * The intent is captured before React mounts (see main.tsx), so by the time
 *    this hook runs it may already be buffered. `useDeepLink` replays it.
 *  * Joining needs an authenticated session, and a cold invite open has none.
 *    So an intent that arrives unauthenticated is HELD, not failed, and retried
 *    once `isAuthenticated` flips.
 *
 * The intent is only acked — permanently discarded — on success, or on an error
 * that can never succeed. Everything else keeps it for the next load.
 */
export function useJoinFromInvitation(): {
  state: JoinState;
  /** Redeem a pasted invitation — same path, no DeepLinkIntent to ack. */
  redeemPasted: (payloadJson: string) => void;
} {
  const { isAuthenticated } = useMero();
  const { joinNamespace } = useJoinNamespace();
  const { joinContext } = useJoinContext();

  const [state, setState] = useState<JoinState>({ status: "idle" });
  // Held here rather than in state: an intent arriving before auth must not
  // trigger a render loop, and we need the resolve/ack callback intact.
  const pending = useRef<{ intent: DeepLinkIntent; payload: KvInvitationPayload } | null>(null);
  const running = useRef(false);

  const redeem = useCallback(async () => {
    const held = pending.current;
    if (!held || running.current) return;
    running.current = true;
    setState({ status: "joining", payload: held.payload });
    try {
      await joinNamespace(held.payload.namespaceId, {
        invitation: held.payload.invitation,
      });
      await joinContext(held.payload.contextId);

      setContextId(held.payload.contextId);
      // Ack FIRST, then reload: a reload before the ack would replay the same
      // intent forever.
      held.intent.resolve?.();
      pending.current = null;
      window.location.reload();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const terminal = isTerminalInvitationError(message);
      if (terminal) {
        // Never going to work — stop asking on every load.
        held.intent.resolve?.();
        pending.current = null;
      }
      setState({ status: "failed", message, retryable: !terminal });
    } finally {
      running.current = false;
    }
  }, [joinNamespace, joinContext]);

  useDeepLink((intent) => {
    // Only `join`. An unknown action must be left alone rather than acked, or
    // this app would silently swallow a link meant for a future feature.
    if (intent.action !== "join") return;
    const encoded = intent.params?.invitation;
    if (!encoded) return;

    const json = decodeInvitationPayload(encoded);
    const payload = json ? parseInvitationPayload(json) : null;
    if (!payload) {
      // Undecodable is terminal by definition: no retry will change the bytes.
      intent.resolve?.();
      setState({
        status: "failed",
        message: "That invitation link could not be read.",
        retryable: false,
      });
      return;
    }
    pending.current = { intent, payload };
    if (isAuthenticated) void redeem();
  });

  // The retry path for an intent that arrived before the session existed.
  useEffect(() => {
    if (isAuthenticated && pending.current) void redeem();
  }, [isAuthenticated, redeem]);

  const redeemPasted = useCallback(
    (payloadJson: string) => {
      const payload = parseInvitationPayload(payloadJson);
      if (!payload) {
        setState({
          status: "failed",
          message: "That invitation could not be read.",
          retryable: false,
        });
        return;
      }
      // No intent to ack: a pasted invitation was never captured by the store,
      // so `resolve` is a no-op and the retry path is the user pasting again.
      pending.current = { intent: { resolve: () => {} } as DeepLinkIntent, payload };
      void redeem();
    },
    [redeem],
  );

  return { state, redeemPasted };
}
