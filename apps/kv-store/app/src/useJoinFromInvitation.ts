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
  /** Nothing pending. */
  | { status: "idle" }
  /**
   * A link arrived and is waiting for the user to say yes.
   *
   * Auto-redeeming was the first version and is wrong: following a link would
   * silently join the user's identity to a namespace someone else chose and
   * switch their active context, with no moment at which they saw what was
   * about to happen. An invitation is a request, so it gets a prompt. The cost
   * is one click; the alternative is a link that acts on your behalf.
   */
  | { status: "confirm"; payload: KvInvitationPayload }
  | { status: "joining"; payload: KvInvitationPayload }
  /**
   * `fromLink` distinguishes the two retry stories: a link-delivered invitation
   * lives in the pending intent store and is replayed on the next load, while a
   * pasted one was never captured there and is simply gone.
   */
  | { status: "failed"; message: string; retryable: boolean; fromLink: boolean };

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
  /** Accept a link-delivered invitation. */
  confirmJoin: () => void;
  /** Refuse one, and stop being asked. */
  declineJoin: () => void;
} {
  const { isAuthenticated } = useMero();
  const { joinNamespace } = useJoinNamespace();
  const { joinContext } = useJoinContext();

  const [state, setState] = useState<JoinState>({ status: "idle" });
  // Set once a join has been attempted for the held intent. Without it, the
  // retry effect below re-fires whenever `redeem`'s identity changes — which is
  // every render if the SDK's hook callbacks are not stable — and a failed join
  // retries in a loop.
  const attempted = useRef(false);
  // Held here rather than in state: an intent arriving before auth must not
  // trigger a render loop, and we need the resolve/ack callback intact.
  const pending = useRef<{
    intent: DeepLinkIntent;
    payload: KvInvitationPayload;
    fromLink: boolean;
  } | null>(null);
  const running = useRef(false);

  const redeem = useCallback(async () => {
    const held = pending.current;
    if (!held || running.current) return;
    running.current = true;
    attempted.current = true;
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
      setState({ status: "failed", message, retryable: !terminal, fromLink: held.fromLink });
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
        fromLink: true,
      });
      return;
    }
    pending.current = { intent, payload, fromLink: true };
    attempted.current = false;
    // NOT redeemed here. The user has to confirm — see JoinState.confirm.
    setState({ status: "confirm", payload });
  });

  // An intent that arrived before the session existed stays in `confirm` until
  // there IS a session — otherwise the prompt would be answerable before the
  // join could possibly work. Deliberately depends on `isAuthenticated` only:
  // adding `redeem` here is what let a failed join retry every render.
  useEffect(() => {
    if (!isAuthenticated || attempted.current) return;
    if (pending.current) setState({ status: "confirm", payload: pending.current.payload });
  }, [isAuthenticated]);

  /** The user said yes to a link. */
  const confirmJoin = useCallback(() => {
    if (!isAuthenticated || !pending.current) return;
    void redeem();
  }, [isAuthenticated, redeem]);

  /** The user said no — forget it, so it does not prompt again on every load. */
  const declineJoin = useCallback(() => {
    pending.current?.intent.resolve?.();
    pending.current = null;
    attempted.current = false;
    setState({ status: "idle" });
  }, []);

  const redeemPasted = useCallback(
    (payloadJson: string) => {
      const payload = parseInvitationPayload(payloadJson);
      if (!payload) {
        setState({
          status: "failed",
          message: "That invitation could not be read.",
          retryable: false,
          fromLink: false,
        });
        return;
      }
      // No intent to ack: a pasted invitation was never captured by the store,
      // so `resolve` is a no-op and the retry path is the user pasting again.
      pending.current = {
        intent: { resolve: () => {} } as DeepLinkIntent,
        payload,
        fromLink: false,
      };
      attempted.current = false;
      // A pasted invitation IS the confirmation — the user typed it in this
      // session, so there is nothing to warn them about.
      void redeem();
    },
    [redeem],
  );

  return { state, redeemPasted, confirmJoin, declineJoin };
}
