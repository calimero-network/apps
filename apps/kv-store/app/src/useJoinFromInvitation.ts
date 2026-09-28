import { useCallback, useEffect, useRef, useState } from "react";
import { useDeepLink } from "@calimero-network/mero-platform-react";
import type { DeepLinkIntent } from "@calimero-network/mero-platform";
import {
  setContextId,
  useDelegatedBootstrap,
  useJoinContext,
  useJoinNamespace,
  useMero,
  type BootstrapFailure,
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
 * How a bootstrap refusal maps onto "will trying again help?".
 *
 * Per STEP, because the steps are not variations of one failure:
 *
 * - `not-invited` — nodes serve the namespace and the invitation names none of
 *   them. No retry changes a signed list; a fresh invitation is the only cure.
 * - `sign` — the op could not be signed from this invitation and credential.
 *   Local and deterministic, so it will fail identically next time.
 * - `admit` at 400 or 403 — the node judged the op or the invitation. Also
 *   final. At 409 it is the node having no device of its own, and another
 *   admitter (or the same one, later) can still work.
 *
 * Everything else — the cloud read failing, a namespace with no fleet
 * assignment, an admitter with a lapsed heartbeat, no credential yet — is kept,
 * matching `isTerminalInvitationError`'s bias: a dropped invitation is
 * unrecoverable for the user, a retried one costs a round trip.
 */
function bootstrapIsTerminal(failure: BootstrapFailure): boolean {
  if (failure.step === "admit") {
    return failure.status === 400 || failure.status === 403;
  }
  return failure.step === "not-invited" || failure.step === "sign";
}

/** Which step failed, in the words a person can act on. */
const BOOTSTRAP_STEP_LABEL: Record<BootstrapFailure["step"], string> = {
  "no-credential": "No enrolled account",
  "admitters-lookup": "Admitters lookup failed",
  "no-nodes": "No hosted node serves this namespace",
  "not-invited": "This invitation names none of the serving nodes",
  "invited-unreachable": "The invited admitter cannot take a join right now",
  "no-relay-url": "The invited admitter has no address yet",
  sign: "The join could not be signed",
  admit: "The admitter refused the join",
};

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
  /*
   * The delegated door.
   *
   * An account that is a member of nothing is signed in and has no relay — the
   * cloud's account→relay read correctly answers `[]` — so the two hooks above
   * have no client to call. The invitation is what breaks that circle: the
   * namespace it names resolves to a node, that node carries the signed join,
   * and the account is a member with a relay from then on.
   *
   * Everything hard about it lives in mero-react (`useDelegatedBootstrap`): the
   * admitters intersection, the signed op, the step names. What is here is the
   * ordering and which refusals are worth keeping the invitation for.
   */
  const { needsBootstrap, bootstrap } = useDelegatedBootstrap();

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
      if (needsBootstrap) {
        /*
         * The delegated path, and deliberately NOT `joinNamespace` +
         * `joinContext`.
         *
         * Those two are a node publishing its own membership op and then joining
         * a context with it. A keyholder has no node to publish from, which is
         * why admission goes to somebody else's: the op is signed here with the
         * device key the account certified, and the admitter can carry it or
         * refuse it and nothing else. There is also no context to join — the
         * relay is already in it, and membership of the namespace is what grants
         * access.
         */
        const outcome = await bootstrap({
          namespaceId: held.payload.namespaceId,
          invitation: held.payload.invitation,        });
        if (!outcome.ok) {
          const terminal = bootstrapIsTerminal(outcome);
          if (terminal) {
            held.intent.resolve?.();
            pending.current = null;
          }
          setState({
            status: "failed",
            // The step, then what it means. A generic "could not join" would
            // conflate an empty intersection, an unreachable admitter and a
            // namespace with no fleet assignment — three unrelated actions.
            message: `${BOOTSTRAP_STEP_LABEL[outcome.step]}. ${outcome.reason}`,
            retryable: !terminal,
            fromLink: held.fromLink,
          });
          return;
        }

        setContextId(held.payload.contextId);
        held.intent.resolve?.();
        pending.current = null;
        // Reloaded for the same reason the node path reloads: the provider reads
        // the stored context on mount, and the connection this just installed
        // lives in sessionStorage, so a reload is what makes the provider and the
        // UI agree instead of duplicating that logic here.
        window.location.reload();
        return;
      }

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
    // `needsBootstrap` and `bootstrap` join the list because this callback now
    // branches on them. Safe for the same reason the others are: `attempted`
    // guards the retry effect, so a changing identity here cannot restart a
    // failed join.
  }, [joinNamespace, joinContext, needsBootstrap, bootstrap]);

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
