// Redeeming a parsed invite: join once, and decide whether it worked.
//
// The deciding is mero-js's `redeemInvitation` (via mero-react), which does not
// trust the join request alone: the desktop proxy aborts an admin request at
// 30s while a namespace join can take far longer and still land. Judged by the
// request, a workspace the node had joined read as "could not join". Asked of
// the node's namespace list, it reads as `already-member`, which the prompt
// routes exactly like a join.
//
// Kept free of React so the whole path is testable against fake node calls.

import {
  describeInviteFailure,
  isFinalInvitationError,
  redeemInvitation,
  type RedeemOutcome,
} from '@calimero-network/mero-react';
import type { ParsedInvite } from '@/hooks/useNamespaceInvitation';

/** The node calls a redeem makes: the join hooks, plus the namespace list. */
export interface InviteCalls {
  joinNamespace: (
    namespaceId: string,
    invitation: ParsedInvite['invitation'],
    groupName?: string,
  ) => Promise<unknown>;
  joinFolder: (
    invitation: ParsedInvite['invitation'],
    groupName?: string,
  ) => Promise<unknown>;
  listNamespaces: () => Promise<readonly { namespaceId: string }[]>;
}

/** The node's own "you are already in it" answer to a join. Membership words
 *  only: "already in the trash" is not a membership rejection. */
const ALREADY_MEMBER = [
  /\balready\s+(a\s+)?(member|joined)\b/i,
  /\balready\s+in\s+(this|the)\s+(group|namespace|workspace|folder)\b/i,
];

function saysAlreadyMember(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return ALREADY_MEMBER.some((re) => re.test(message));
}

/** How long to keep asking the node to join a folder it may not have synced. */
export const FOLDER_JOIN_MS = 90_000;
const FOLDER_RETRY_MS = 3_000;

/**
 * Join what `parsed` invites to. Never throws: a refused join and an
 * unreachable node are both a `failed` outcome.
 *
 * A folder is a subgroup, not a namespace, so the namespace list cannot vouch
 * for it; the only membership proof a failed folder join has is the node
 * saying so. Without that, its membership is "could not tell".
 *
 * A folder join is retried: right after the namespace join the node may not
 * hold the folder subgroup yet and refuses it, and one attempt per page load
 * left a locked folder until a reload. Only a refusal that may still change is
 * retried; a final one (expired, revoked, a 4xx) ends it at once. Still refused
 * at the deadline, the outcome stays retryable, so the invitation is kept.
 */
export async function redeemInvite(
  parsed: ParsedInvite,
  calls: InviteCalls,
): Promise<RedeemOutcome> {
  if (parsed.kind === 'namespace') return redeemOnce(parsed, calls);
  const deadline = Date.now() + FOLDER_JOIN_MS;
  for (;;) {
    const outcome = await redeemOnce(parsed, calls);
    if (
      outcome.status !== 'failed' ||
      !outcome.retryable ||
      isFinalInvitationError(outcome.message) ||
      Date.now() > deadline
    ) {
      return outcome;
    }
    await new Promise((resolve) => setTimeout(resolve, FOLDER_RETRY_MS));
  }
}

function redeemOnce(
  parsed: ParsedInvite,
  calls: InviteCalls,
): Promise<RedeemOutcome> {
  let nodeSaysMember = false;
  return redeemInvitation(
    {
      namespaceId: parsed.targetId,
      invitation: parsed.invitation,
      teamName: parsed.targetName,
    },
    {
      join: async () => {
        try {
          if (parsed.kind === 'namespace') {
            await calls.joinNamespace(
              parsed.targetId,
              parsed.invitation,
              parsed.targetName,
            );
          } else {
            await calls.joinFolder(parsed.invitation, parsed.targetName);
          }
        } catch (err) {
          nodeSaysMember = saysAlreadyMember(err);
          throw err;
        }
      },
      memberships: async () => {
        if (nodeSaysMember) return [parsed.targetId];
        if (parsed.kind !== 'namespace') {
          throw new Error('Folder membership is not listable');
        }
        return (await calls.listNamespaces()).map((n) => n.namespaceId);
      },
    },
  );
}

/** What the prompt says about a failed redeem, in the scope's own noun. A link
 *  already used and a removal by an admin each have their own reason (mero-js
 *  26.1), so the shared wording already tells the person what to do. */
export function inviteFailureCopy(
  outcome: Extract<RedeemOutcome, { status: 'failed' }>,
  noun: 'workspace' | 'folder',
): string {
  return describeInviteFailure(outcome.reason, noun) ?? outcome.message;
}
