import { useRef } from "react";
import {
  setContextId,
  useInviteRedemption,
  useMero,
  type InviteRedemption,
  type ParsedInvitation,
} from "@calimero-network/mero-react";
import type {
  InviteRedeemer,
  SignedGroupOpenInvitation,
} from "@calimero-network/mero-js";
import {
  decodeInvitationPayload,
  parseInvitationPayload,
} from "./utils/invitation";

/** What a captured invitation names: the namespace, and the context to open in it. */
export type KombatInvitation = ParsedInvitation & { contextId: string };

/** The redemption, with `parsed` carrying the context this app's links name. */
export type JoinFromInvitation = InviteRedemption<KombatInvitation>;

/** Read a link's token into what the join needs, or `null` if it is not one. */
export function readInvitation(token: string): KombatInvitation | null {
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
 * load. mero-js decides which, and treats "the request failed
 * but the namespace is now listed" as success: the desktop proxy aborts at 30s
 * while a join can take ~95s and land anyway.
 *
 * Once in, `open` is handed the context the link names. The app opens it in
 * place rather than reloading: a reload would take down the invitation dialog
 * while it is still waiting on the context's data.
 */
export function useJoinFromInvitation(
  open: (contextId: string) => void,
): JoinFromInvitation {
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
      // A node joins the context explicitly. An account does not: a namespace
      // member follows its contexts (core auto-follow), and this app's contexts
      // live directly in the namespace, so there is no further group to join —
      // and the `admin` this closure holds may predate the relay the join just
      // moved the session onto, so a read through it here would fail after a
      // join that succeeded.
      if (!isDelegated && contextId.current)
        await admin.joinContext(contextId.current);
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

  return useInviteRedemption<KombatInvitation>({
    parse: (token) => {
      const parsed = readInvitation(token);
      contextId.current = parsed?.contextId ?? null;
      return parsed;
    },
    redeemer,
    enabled: isAuthenticated,
    // `already-member` lands here too: a link followed twice, or a join the
    // proxy gave up on that landed anyway. Stored as well as opened, so the
    // next load comes back to the same context.
    onJoined: () => {
      if (!contextId.current) return;
      setContextId(contextId.current);
      open(contextId.current);
    },
  });
}
