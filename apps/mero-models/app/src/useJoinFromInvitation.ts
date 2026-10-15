import { useRef } from "react";
import {
  redeemInvitation,
  setContextId,
  useInviteRedemption,
  useMero,
  type InviteRedeemer,
  type InviteRedemption,
  type ParsedInvitation,
  type RedeemOutcome,
} from "@calimero-network/mero-react";
import type { SignedGroupOpenInvitation } from "@calimero-network/mero-js";
import {
  decodeInvitationPayload,
  parseInvitationPayload,
} from "./utils/invitation";

/** What a captured invitation names: the namespace, and the context to open in it. */
export type ModelsInvitation = ParsedInvitation & { contextId: string };

/** The redemption, with `parsed` carrying the context this app's links name. */
export type JoinFromInvitation = InviteRedemption<ModelsInvitation>;

/** Read a link's token into what the join needs, or `null` if it is not one. */
export function readInvitation(token: string): ModelsInvitation | null {
  const json = decodeInvitationPayload(token);
  const payload = json ? parseInvitationPayload(json) : null;
  if (!payload) return null;
  return {
    namespaceId: payload.namespaceId,
    invitation: payload.invitation,
    contextId: payload.contextId,
  };
}

/**
 * Redeem an invitation that arrived by link, once the user says yes.
 *
 * The link is captured before React mounts (main.tsx) and buffered until this
 * hook subscribes, which it does only once there is a session — a cold invite
 * open has none. Mount it once, above anything that navigates, so a link
 * opened on any page reaches it. It then ASKS: following a link must not join the user's
 * identity to a namespace someone else chose and switch their context without a
 * moment in which they saw what was about to happen.
 *
 * The invitation is acked — permanently dropped — on success, or on a failure
 * that can never succeed; anything else is kept and offered again on the next
 * load. mero-js decides which, and treats "the request failed but the namespace
 * is now listed" as success: the desktop proxy aborts at 30s while a join can
 * take ~95s and land anyway.
 */
export function useJoinFromInvitation({
  landingPath,
  onOpen,
}: {
  /** Where the joined context opens, for an app whose landing page is elsewhere. */
  landingPath?: string;
  /**
   * Open the joined scene in this page. Without it (or on an account, see
   * below) the page reloads into it instead, which also ends the invitation
   * dialog: a node session should always pass it.
   */
  onOpen?: (contextId: string, namespaceId: string) => void;
} = {}): JoinFromInvitation {
  // `admin`, NOT `mero.admin`. `mero` is the raw client, and on a delegated
  // (account) session its transport is the relay: `mero.admin.joinNamespace`
  // became `POST {relay}/admin-api/namespaces/{ns}/join` with the account's
  // bearer token, which carries no `namespace:manage` — a 403 the redeemer
  // then reported as "you can't join with this invitation". `admin` is the
  // session-aware one: the node's own client on a node login, and on an
  // account the account admin, whose `joinNamespace` redeems the invitation
  // through the admitter's unauthenticated route and moves the session onto
  // that relay once it is in.
  const { isAuthenticated, admin, isDelegated } = useMero();

  // The context the captured link names. Set by `parse`, which always runs
  // before the join and before `onJoined`.
  const contextId = useRef<string | null>(null);

  // The admin client directly, not `useJoinNamespace` / `useJoinContext`: those
  // hooks catch a failed request and resolve `null`, so a refused join looked
  // exactly like a successful one. `join` has to throw, with the node's HTTP
  // status on the error, for the outcome to say why.
  const redeemer: InviteRedeemer = {
    join: async (namespaceId, invitation) => {
      if (!admin) throw new Error("Not connected.");
      await admin.joinNamespace(namespaceId, {
        invitation: invitation as SignedGroupOpenInvitation,
      });
    },
    memberships: async () => {
      if (!admin) throw new Error("Not connected.");
      // rc.25 renamed `groupId` -> `namespaceId`; read both (see ContextPicker).
      const namespaces = (await admin.listNamespaces()) as Array<{
        namespaceId?: string;
        groupId?: string;
        id?: string;
      }>;
      return namespaces.map((n) => n.namespaceId ?? n.groupId ?? n.id ?? "");
    },
  };

  // The namespace, then the context. A node joins the context explicitly. An
  // account does not: a namespace member follows its contexts (core
  // auto-follow), and this app's contexts live directly in the namespace, so
  // there is no further group to join — and the `admin` this closure holds may
  // predate the relay the join just moved the session onto.
  //
  // The context join is its own step after the namespace's, not part of it,
  // and it is retried: right after the namespace join the node may not hold
  // the context yet and refuses it. Inside `join`, that refusal read as "the
  // namespace is listed, so already a member": the invitation was spent and
  // the app opened a context this node never joined. A namespace join that
  // landed without answering (the desktop proxy's 30s) skipped it outright.
  const redeem = async (parsed: ModelsInvitation): Promise<RedeemOutcome> => {
    const outcome = await redeemInvitation(parsed, redeemer);
    if (outcome.status === "failed" || isDelegated || !admin) return outcome;
    const failure = await joinContextWithRetry(() => admin.joinContext(parsed.contextId));
    if (failure === null) return outcome;
    // Kept, so "Try again" goes round once more: the namespace join is then
    // already-member and only the context is retried.
    return {
      status: "failed",
      namespaceId: parsed.namespaceId,
      message: `You joined the namespace, but this node could not join its scene yet: ${failure}`,
      reason: "unknown",
      retryable: true,
    };
  };

  return useInviteRedemption<ModelsInvitation>({
    parse: (token) => {
      const parsed = readInvitation(token);
      contextId.current = parsed?.contextId ?? null;
      return parsed;
    },
    redeem,
    enabled: isAuthenticated,
    // `already-member` lands here too: a link followed twice, or a join the
    // proxy gave up on that landed anyway. Runs after the namespace is marked
    // just-joined, so the studio that opens next is the one that clears it.
    onJoined: (namespaceId) => {
      const joined = contextId.current;
      if (!joined) return;
      // Stored too, so a reload stays in the joined scene.
      setContextId(joined);
      // In-page on a node, so the dialog stays up through "Syncing…" until the
      // studio has read the scene. An account still reloads: the provider builds
      // its relay client for the context it read from storage on mount, and has
      // no way to switch to another one in place.
      if (onOpen && !isDelegated) {
        onOpen(joined, namespaceId);
      } else if (landingPath && window.location.pathname !== landingPath) {
        window.location.assign(landingPath);
      } else {
        window.location.reload();
      }
    },
  });
}

/** How long to keep asking the node to join the context once the namespace is joined. */
export const CONTEXT_JOIN_MS = 90_000;
const CONTEXT_RETRY_MS = 3_000;

/** Join until the node accepts; null once it has, else the last error's words. */
async function joinContextWithRetry(join: () => Promise<unknown>): Promise<string | null> {
  const deadline = Date.now() + CONTEXT_JOIN_MS;
  for (;;) {
    try {
      await join();
      return null;
    } catch (e) {
      if (Date.now() > deadline) return e instanceof Error ? e.message : String(e);
    }
    await new Promise((resolve) => setTimeout(resolve, CONTEXT_RETRY_MS));
  }
}
