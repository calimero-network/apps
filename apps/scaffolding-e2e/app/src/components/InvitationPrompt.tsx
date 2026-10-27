import { useCallback, useEffect, useRef, useState } from "react";
import {
  InvitationDialog,
  redeemInvitation,
  useInviteRedemption,
  type InviteRedeemer,
  type ParsedInvitation,
  type RedeemOutcome,
} from "@calimero-apps/cloud";
import {
  getContextIdentities,
  joinContextById,
  joinNamespace,
  listNamespaces,
} from "../api/adminApi";
import { rpcRaw } from "../api/rpc";
import { setContextId, setContextIdentity } from "../lib/mero";
import { readInviteToken, type InvitePayload } from "../lib/invite";

/** How long to keep trying the context once the namespace is joined. */
const CONTEXT_JOIN_MS = 90_000;
const CONTEXT_RETRY_MS = 3_000;
/** How long to keep asking the joined context for its state. */
const STATE_READ_MS = 90_000;
const STATE_RETRY_MS = 2_000;

const redeemer: InviteRedeemer = {
  join: (namespaceId, invitation) =>
    joinNamespace(namespaceId, invitation as object),
  memberships: async () => (await listNamespaces()).map((n) => n.namespaceId),
};

interface ScaffoldInvitation extends ParsedInvitation {
  payload: InvitePayload;
}

const short = (id: string) => `${id.slice(0, 16)}…`;
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Node B's whole join: an invitation link was opened, so ask, then join the
 * namespace and the context inside it.
 *
 * The link reaches the app through the shared capture (primed in main.tsx):
 * `?invitation=…` on a page load, or a `deep-link` event from a running
 * desktop. Mounted in the signed-in layout, above every section, so it shows
 * whichever section is open; before sign-in the invitation is buffered.
 *
 * It is mero-react's `InvitationDialog`. It asks first — joining gives Node A's
 * namespace a peer on this node — and then does what the wizard's joiner steps
 * used to make you do by hand: join the namespace with the signed invitation,
 * then join and activate the context the link names. The context join is
 * retried: right after the namespace join the node may not hold the context's
 * membership yet. The dialog stays on "Syncing…" until a read of that context's
 * state (the store's `len`) has come back from this node.
 */
export function InvitationPrompt({
  onContextJoined,
}: {
  onContextJoined: (contextId: string) => void;
}) {
  const onContextJoinedRef = useRef(onContextJoined);
  onContextJoinedRef.current = onContextJoined;
  const [status, setStatus] = useState<string | null>(null);
  /** The namespace whose joined context has answered a read. */
  const [readFor, setReadFor] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const parse = useCallback((token: string): ScaffoldInvitation | null => {
    const payload = readInviteToken(token);
    return payload
      ? {
          namespaceId: payload.namespaceId,
          invitation: payload.invitation,
          payload,
        }
      : null;
  }, []);

  /** Join and activate the context; the last error if it never would. */
  const joinContext = useCallback(async (contextId: string) => {
    setStatus(`Joined the namespace. Joining context ${short(contextId)}…`);
    const deadline = Date.now() + CONTEXT_JOIN_MS;
    let last = "";
    while (alive.current) {
      try {
        await joinContextById(contextId);
        const identities = await getContextIdentities(contextId);
        setContextId(contextId);
        if (identities[0]) setContextIdentity(identities[0]);
        return null;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
      }
      if (Date.now() > deadline) break;
      await sleep(CONTEXT_RETRY_MS);
    }
    return last || "The context could not be joined.";
  }, []);

  /** Wait for the context's state to answer, empty or not. */
  const readState = useCallback(
    async (namespaceId: string, contextId: string) => {
      const deadline = Date.now() + STATE_READ_MS;
      while (alive.current) {
        const envelope = await rpcRaw("len", {}, contextId).catch(() => null);
        if (envelope && !envelope.error) {
          if (alive.current) setReadFor(namespaceId);
          return;
        }
        if (Date.now() > deadline) return;
        await sleep(STATE_RETRY_MS);
      }
    },
    [],
  );

  const redeem = useCallback(
    async (parsed: ScaffoldInvitation): Promise<RedeemOutcome> => {
      setReadFor(null);
      try {
        const outcome = await redeemInvitation(parsed, redeemer);
        const contextId = parsed.payload.contextId;
        if (outcome.status === "failed" || !contextId) return outcome;
        const failure = await joinContext(contextId);
        if (failure) {
          // Kept, so "Try again" goes round once more: the namespace join is
          // then already-member and only the context is retried.
          return {
            status: "failed",
            namespaceId: parsed.namespaceId,
            message: `Joined the namespace, but not context ${short(contextId)}: ${failure}`,
            reason: "unknown",
            retryable: true,
          };
        }
        onContextJoinedRef.current(contextId);
        void readState(parsed.namespaceId, contextId);
        return outcome;
      } finally {
        setStatus(null);
      }
    },
    [joinContext, readState],
  );

  const redemption = useInviteRedemption({ parse, redeem });
  const { state } = redemption;

  return (
    <InvitationDialog
      redemption={redemption}
      noun="namespace"
      appName="Calimero E2E"
      status={status}
      synced={state.stage === "joined" && readFor === state.namespaceId}
    />
  );
}
