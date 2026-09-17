/**
 * Choosing a node to present a signed join to.
 *
 * Two sources answer two different questions and neither answers both.
 *
 * **The invitation says who is ALLOWED.** `invitation.admitters` is inside the
 * body the group admin signed, so it is authorization: a node not in that list
 * refuses the claim whatever else is true of it. It is also a *mint-time
 * snapshot* — the admin listed the nodes serving the namespace when the
 * invitation was written, and said nothing about the ones assigned since.
 *
 * **The cloud says who is REACHABLE.** `getNamespaceRouting` reports the fleet
 * rows as they are now: a URL, the node's account, whether its heartbeat is
 * fresh, whether it can admit, whether it holds `CAN_AUTHOR_ON_BEHALF`. It
 * cannot know which invitation the caller holds, so it cannot filter by the
 * signed list.
 *
 * So the answer is the intersection, and getting it wrong fails in two
 * distinguishable ways worth naming separately in a UI:
 *
 * - a node in the signed list that the cloud does not show as usable is one the
 *   admin trusted and that is currently down or unreachable — wait, or use
 *   another;
 * - a node the cloud shows as healthy that is NOT in the signed list is live,
 *   listed, and will still answer a claim with 403, because the admin never
 *   named it. That is the case the mero-js docs single out, and the one most
 *   likely to be read as a bug in the node rather than as the invitation being
 *   older than the fleet.
 *
 * Accounts are compared case-insensitively and with any `0x` stripped: both
 * sides are hex for the same 32 bytes, and a mismatch in spelling would present
 * as "not invited" — a refusal that looks like policy and is really formatting.
 */

/** The fields of mero-js's `CloudNamespaceNode` this decision needs. */
export interface RoutableNode {
  readonly peerId: string;
  readonly account: string | null;
  readonly relayUrl: string | null;
  readonly admitUrl: string | null;
  readonly fresh: boolean;
  readonly canAdmit: boolean;
  readonly canExecute: boolean;
}

/** Why a node cannot be used, or that it can. */
export type Admissibility =
  /** In the signed list and usable now. */
  | { readonly kind: 'usable' }
  /** In the signed list, but the cloud does not report it as able to admit. */
  | { readonly kind: 'invited-unreachable' }
  /** Healthy, but the invitation does not name it — a claim here is refused. */
  | { readonly kind: 'not-invited' };

export interface ClassifiedNode {
  readonly node: RoutableNode;
  readonly admissibility: Admissibility;
}

/** Normalise a hex account for comparison. `null` for anything unusable. */
export function normaliseAccount(account: string | null | undefined): string | null {
  if (!account) return null;
  const trimmed = account.trim().toLowerCase();
  const bare = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  return bare.length > 0 ? bare : null;
}

/**
 * Classify every routable node against the invitation's signed admitter list.
 *
 * Order is preserved: the cloud already sorts usable nodes first, and
 * re-sorting here would make a polling caller see rows move for reasons the
 * cloud did not intend.
 */
export function classifyNodes(
  nodes: readonly RoutableNode[],
  signedAdmitters: readonly string[],
): ClassifiedNode[] {
  const invited = new Set(
    signedAdmitters.map(normaliseAccount).filter((a): a is string => a !== null),
  );
  return nodes.map((node) => {
    const account = normaliseAccount(node.account);
    // An empty signed list is the legacy "any ready peer may admit" shape, not
    // "nobody may". Treating it as nobody would refuse every invitation minted
    // before the field existed.
    const isInvited = invited.size === 0 || (account !== null && invited.has(account));
    if (!isInvited) return { node, admissibility: { kind: 'not-invited' } as const };
    return {
      node,
      admissibility: (node.canAdmit
        ? { kind: 'usable' }
        : { kind: 'invited-unreachable' }) as Admissibility,
    };
  });
}

/**
 * The node to present the join to, or `null` with the reason none will do.
 *
 * Prefers a usable node that can also execute delegated writes, so the demo
 * lands on one node for both legs where it can — but never at the cost of
 * admission, which is the step that cannot proceed without it.
 */
export function chooseAdmitter(classified: readonly ClassifiedNode[]): {
  readonly chosen: RoutableNode | null;
  readonly reason: string | null;
} {
  const usable = classified.filter((c) => c.admissibility.kind === 'usable');
  const first = usable[0];
  if (first !== undefined) {
    const executing = usable.find((c) => c.node.canExecute);
    return { chosen: (executing ?? first).node, reason: null };
  }
  const invitedDown = classified.some((c) => c.admissibility.kind === 'invited-unreachable');
  const liveButUninvited = classified.some((c) => c.admissibility.kind === 'not-invited');
  if (invitedDown) {
    return {
      chosen: null,
      reason:
        'Every node your invitation names is currently unreachable — no fresh heartbeat, ' +
        'or no relay URL yet. This is a wait, not a wrong invitation.',
    };
  }
  if (liveButUninvited) {
    return {
      chosen: null,
      reason:
        'Nodes are serving this namespace, but your invitation names none of them. The ' +
        'signed admitter list is a snapshot from when the invitation was minted, so a node ' +
        'assigned since is healthy and will still refuse the claim. Ask for a fresh invitation.',
    };
  }
  return { chosen: null, reason: 'The cloud reports no nodes serving this namespace yet.' };
}

/**
 * The node to send the delegated WRITE to, which is a different question from
 * admission and has a different answer.
 *
 * ## Why this is not `chooseAdmitter`
 *
 * {@link chooseAdmitter} intersects against the invitation's signed
 * `admitters`, because admission is what that list authorises: a node outside
 * it refuses a join claim. **Authorship is not on that list.** What lets a node
 * write on your behalf is `CAN_AUTHOR_ON_BEHALF` on the owning group — a
 * governance op its admin signed — and the cloud reports it as `canExecute`.
 *
 * So the executor is chosen across EVERY node the cloud lists, not just the
 * invited ones. Intersecting here would be over-restrictive in the exact case
 * this exists to handle: a node assigned after the invitation was minted is
 * absent from the signed list, is a perfectly valid relay, and would be
 * discarded for a reason that does not apply to writes.
 *
 * ## Why it is a separate selection at all
 *
 * `chooseAdmitter` already *prefers* a node that can do both, so the two often
 * agree and the demo lands on one node for both legs. But it prefers — it never
 * insists, because admission is the step that cannot proceed without a node and
 * authorship is not. When no invited node can execute it returns an admit-only
 * node, and before this function existed the write leg then posted to that node
 * anyway: the UI said "it can admit but not execute" and the button walked
 * straight into it.
 *
 * The two legs are genuinely independent — the intent carries a warrant, not
 * the session token, so the relay need not be the node that issued the session.
 *
 * `null` with a reason where nothing can execute. That is a real state, not an
 * error: a fleet whose nodes hold no authorship grant is healthy and simply not
 * writable yet, and the remedy is a governance op, not a retry.
 */
export function chooseExecutor(nodes: readonly RoutableNode[]): {
  readonly chosen: RoutableNode | null;
  readonly reason: string | null;
} {
  const executing = nodes.find((n) => n.canExecute && n.relayUrl !== null);
  if (executing !== undefined) return { chosen: executing, reason: null };

  // Split the two ways this fails, because the remedies are unrelated.
  const grantedButUnreachable = nodes.some((n) => n.canExecute && n.relayUrl === null);
  if (grantedButUnreachable) {
    return {
      chosen: null,
      reason:
        'A node holds the authorship grant but the cloud knows no relay URL for it yet. ' +
        'This is a wait, not a missing permission.',
    };
  }
  if (nodes.length > 0) {
    return {
      chosen: null,
      reason:
        'No node serving this namespace holds CAN_AUTHOR_ON_BEHALF, so nothing can write ' +
        'on your behalf yet. An admin of the owning group grants it — the cloud only ' +
        'reports it. Reads and the session still work.',
    };
  }
  return {
    chosen: null,
    reason: 'The cloud lists no nodes for this namespace, so there is no relay to write through.',
  };
}
