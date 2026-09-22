import { useCallback, useEffect, useRef, useState } from "react";
import { markNamespaceJustJoined } from "@calimero-apps/join-sync";

import { onInvitation, type CapturedInvitation } from "./capture";
import {
  redeemInvitation,
  shouldRetain,
  type InviteRedeemer,
  type RedeemOutcome,
} from "./redeem";

/** What the token carries, once the app's codec has read it. */
export interface ParsedInvitation {
  namespaceId: string;
  /** The invitation struct the node's join body expects. */
  invitation: unknown;
  /** The human name the inviter embedded, if any. */
  teamName?: string;
}

/**
 * Where redemption has got to, for rendering.
 *
 * `joining` is the state nothing in this repo used to have: following an invite
 * link put the app on a page with no sign anything was happening, for as long
 * as the join took — up to 95s when no member of the namespace was online.
 */
export type InviteState =
  | { stage: "idle" }
  | { stage: "awaiting-confirmation"; teamName?: string }
  | { stage: "joining"; teamName?: string }
  | { stage: "joined"; namespaceId: string; teamName?: string }
  | { stage: "already-member"; namespaceId: string; teamName?: string }
  | { stage: "failed"; message: string; retryable: boolean };

export interface UseInviteRedemptionOptions {
  /**
   * Read a raw token into its parts. Return `null` (or throw) if it is not a
   * usable invitation — the app owns this because the codecs differ slightly.
   */
  parse: (token: string) => ParsedInvitation | null;
  /** The two calls that differ between apps. */
  redeemer: InviteRedeemer;
  /**
   * Ask before joining, rather than joining on arrival.
   *
   * Not a stylistic choice, and deliberately per-app. Joining is a state
   * change: it puts you in someone else's namespace and gives them a peer that
   * syncs their data. For an app holding secrets — mero-pass is the clear case
   * — doing that on page load means a forwarded link, or a background tab that
   * refreshes, joins silently. Decoding is pure and local, so the scope can be
   * shown first and the join can need a click.
   *
   * With this set the state goes `awaiting-confirmation` and waits for
   * `accept()`; `decline()` acks the invitation so it stops coming back.
   */
  confirm?: boolean;
  /**
   * Called once, after a join has landed and before anything navigates. The
   * `already-member` case calls it too: the app still has to go and look at a
   * namespace it may never have opened.
   */
  onJoined?: (namespaceId: string, teamName?: string) => void;
  /**
   * Hold off until the app can actually join — a session, a resolved
   * application id. The invitation is buffered meanwhile, not dropped.
   */
  enabled?: boolean;
}

export interface InviteRedemption {
  state: InviteState;
  /** The captured token, for prefilling a manual join field. */
  token: string | null;
  /** What the invitation names, available while confirming. */
  parsed: ParsedInvitation | null;
  /** Go ahead with a join that is `awaiting-confirmation`. */
  accept: () => void;
  /** Decline it, and ack it so it does not come back. */
  decline: () => void;
  /** Retry the captured invitation by hand, past the automatic attempt cap. */
  retry: () => void;
  /** Take the result off the screen. */
  dismiss: () => void;
}

/**
 * Redeem an invitation that arrived by link, and report progress.
 *
 * Mount this once, high enough that it is not unmounted by routing. Capture is
 * process-wide and buffers, so mounting late is safe; being unmounted mid-join
 * only loses the on-screen state, never the invitation (it is acked on the
 * outcome, not on the render).
 */
export function useInviteRedemption({
  parse,
  redeemer,
  confirm = false,
  onJoined,
  enabled = true,
}: UseInviteRedemptionOptions): InviteRedemption {
  const [state, setState] = useState<InviteState>({ stage: "idle" });
  const [token, setToken] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedInvitation | null>(null);

  // Read through refs so a re-created `parse`/`redeemer`/`onJoined` — which is
  // every render, in most apps — does not resubscribe and re-fire the join.
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const redeemerRef = useRef(redeemer);
  redeemerRef.current = redeemer;
  const onJoinedRef = useRef(onJoined);
  onJoinedRef.current = onJoined;
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;

  /** Tokens already attempted this session, so nothing loops within one load. */
  const attempted = useRef<Set<string>>(new Set());
  /** The pending ack for the captured invitation, held for confirm/retry. */
  const pending = useRef<CapturedInvitation | null>(null);
  const parsedRef = useRef<ParsedInvitation | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Do the join and report the outcome. */
  const perform = useCallback(
    async (captured: CapturedInvitation, invitation: ParsedInvitation) => {
      if (alive.current)
        setState({ stage: "joining", teamName: invitation.teamName });

      const outcome: RedeemOutcome = await redeemInvitation(
        invitation,
        redeemerRef.current,
      );

      if (!shouldRetain(outcome)) captured.resolve();

      if (outcome.status === "joined" || outcome.status === "already-member") {
        // Before any navigation, so the gate is already set wherever the app
        // sends the user next.
        markNamespaceJustJoined(outcome.namespaceId);
        onJoinedRef.current?.(outcome.namespaceId, outcome.teamName);
      }

      if (!alive.current) return;
      setState(
        outcome.status === "failed"
          ? {
              stage: "failed",
              message: outcome.message,
              retryable: outcome.retryable,
            }
          : {
              stage: outcome.status,
              namespaceId: outcome.namespaceId,
              teamName: outcome.teamName,
            },
      );
    },
    [],
  );

  /** Parse, then either ask or go. */
  const begin = useCallback(
    (captured: CapturedInvitation) => {
      let invitation: ParsedInvitation | null = null;
      try {
        invitation = parseRef.current(captured.token);
      } catch {
        invitation = null;
      }
      if (!invitation?.namespaceId) {
        // Unreadable: retrying cannot help, so ack it rather than leave it to
        // replay forever.
        captured.resolve();
        if (alive.current) {
          setState({
            stage: "failed",
            message: "That invitation could not be read.",
            retryable: false,
          });
        }
        return;
      }

      parsedRef.current = invitation;
      if (alive.current) setParsed(invitation);

      if (confirmRef.current) {
        if (alive.current) {
          setState({
            stage: "awaiting-confirmation",
            teamName: invitation.teamName,
          });
        }
        return;
      }
      void perform(captured, invitation);
    },
    [perform],
  );

  useEffect(() => {
    if (!enabled) return;
    return onInvitation((captured) => {
      pending.current = captured;
      setToken(captured.token);
      if (!captured.autoJoin || attempted.current.has(captured.token)) return;
      attempted.current.add(captured.token);
      begin(captured);
    });
  }, [enabled, begin]);

  const accept = useCallback(() => {
    const captured = pending.current;
    const invitation = parsedRef.current;
    if (!captured || !invitation) return;
    void perform(captured, invitation);
  }, [perform]);

  const decline = useCallback(() => {
    // "Not now" IS handled. Without the ack the same prompt returns on every
    // load, which reads as the app nagging rather than as durability.
    pending.current?.resolve();
    setState({ stage: "idle" });
  }, []);

  const retry = useCallback(() => {
    const captured = pending.current;
    if (!captured) return;
    attempted.current.add(captured.token);
    begin(captured);
  }, [begin]);

  const dismiss = useCallback(() => setState({ stage: "idle" }), []);

  return { state, token, parsed, accept, decline, retry, dismiss };
}
