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
  onJoined,
  enabled = true,
}: UseInviteRedemptionOptions): InviteRedemption {
  const [state, setState] = useState<InviteState>({ stage: "idle" });
  const [token, setToken] = useState<string | null>(null);

  // Read through refs so a re-created `parse`/`redeemer`/`onJoined` — which is
  // every render, in most apps — does not resubscribe and re-fire the join.
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const redeemerRef = useRef(redeemer);
  redeemerRef.current = redeemer;
  const onJoinedRef = useRef(onJoined);
  onJoinedRef.current = onJoined;

  /** Tokens already attempted this session, so nothing loops within one load. */
  const attempted = useRef<Set<string>>(new Set());
  /** The pending ack for the captured invitation, held for a manual retry. */
  const pending = useRef<CapturedInvitation | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async (captured: CapturedInvitation) => {
    let parsed: ParsedInvitation | null = null;
    try {
      parsed = parseRef.current(captured.token);
    } catch {
      parsed = null;
    }
    if (!parsed?.namespaceId) {
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

    if (alive.current)
      setState({ stage: "joining", teamName: parsed.teamName });

    const outcome: RedeemOutcome = await redeemInvitation(
      parsed,
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
  }, []);

  useEffect(() => {
    if (!enabled) return;
    return onInvitation((captured) => {
      pending.current = captured;
      setToken(captured.token);
      if (!captured.autoJoin || attempted.current.has(captured.token)) return;
      attempted.current.add(captured.token);
      void run(captured);
    });
  }, [enabled, run]);

  const retry = useCallback(() => {
    const captured = pending.current;
    if (!captured) return;
    attempted.current.add(captured.token);
    void run(captured);
  }, [run]);

  const dismiss = useCallback(() => setState({ stage: "idle" }), []);

  return { state, token, retry, dismiss };
}
