// Redeeming a parsed invite: join once, and decide whether it worked.
//
// The deciding is `@calimero-apps/invite`'s `redeemInvitation`, which does not
// trust the join request alone: the desktop proxy aborts an admin request at
// 30s while a namespace join can take far longer and still land. Judged by the
// request, a workspace the node had joined read as "could not join". Asked of
// the node's namespace list, it reads as `already-member`, which the card
// routes exactly like a join.
//
// Kept free of React so the whole path is testable against fake node calls.

import {
  describeInviteFailure,
  redeemInvitation,
  type RedeemOutcome,
} from '@calimero-apps/invite';
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

/**
 * Join what `parsed` invites to. Never throws: a refused join and an
 * unreachable node are both a `failed` outcome.
 *
 * A folder is a subgroup, not a namespace, so the namespace list cannot vouch
 * for it; the only membership proof a failed folder join has is the node
 * saying so. Without that, its membership is "could not tell".
 */
export function redeemInvite(
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

/**
 * The refusals a person can do something specific about, read off the node's
 * message. Core answers both with a 409, which the shared classifier files as
 * a generic `refused` - true, but "ask an admin to invite you again" sends
 * someone whose link is merely spent to the wrong person, and someone who was
 * removed to ask for a link that cannot readmit them.
 */
const SPECIFIC_REFUSALS: ReadonlyArray<[RegExp, string]> = [
  [
    /InvitationAlreadyConsumed|already used this invitation/i,
    "You've already used this link — ask for a new one.",
  ],
  [
    /RemovedFromGroup|was removed from group|cannot rejoin/i,
    'An admin removed you — ask to be re-added.',
  ],
];

/** What the card says about a failed redeem, in the scope's own noun: the
 *  shared wording, plus a line naming the refusal when the node's message
 *  says which one it was. */
export function inviteFailureCopy(
  outcome: Extract<RedeemOutcome, { status: 'failed' }>,
  noun: 'workspace' | 'folder',
): string {
  const general =
    describeInviteFailure(outcome.reason, noun) ?? outcome.message;
  const specific = SPECIFIC_REFUSALS.find(([re]) => re.test(outcome.message));
  return specific ? `${general} ${specific[1]}` : general;
}
