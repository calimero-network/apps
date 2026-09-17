// ── Where an agreement's name comes from ─────────────────────────────────────
//
// The bug this exists to close: the creator typed "NDA with Acme" and everybody
// they invited saw "Agreement".
//
// MeroSign stores an agreement's name in TWO places, and only one of them is
// shared:
//
//   * `MeroSignState.context_name` in the AGREEMENT's own (shared) context — an
//     `LwwRegister<String>` set from the init params at `createContext`. This is
//     contract state, so it replicates to every node that joins. It is the only
//     value that can possibly be the same on both nodes, and it is therefore the
//     only authoritative one.
//   * `ContextMetadata.context_name` inside each participant's PRIVATE context,
//     written once by `join_shared_context` when they join. This is a per-person
//     snapshot; the dashboard reads it because that is where the list of "my
//     agreements" lives.
//
// The old join paths filled the second from a text box the joiner was asked to
// type ("Context Name (Optional)"), defaulting to the literal string
// `'Agreement'`. So the shared, replicated, correct name was sitting in contract
// state the whole time and nothing ever read it.
//
// The rule this module encodes: the contract wins, the invitation's hint is the
// stand-in while the contract has not synced yet, and a truncated context id is
// the last resort — never a generic word, because "Agreement" next to
// "Agreement" next to "Agreement" is indistinguishable from a broken list.
//
// Pure. No network, no storage.

/** Placeholder names earlier builds wrote into private contexts. */
const PLACEHOLDERS = new Set(['agreement', 'context', 'default', 'untitled']);

function clean(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * A stable, distinguishable name for an agreement with no real name.
 *
 * Includes the id so two unnamed agreements do not render identically; a list of
 * rows that all say the same thing is worse than a list of rows that say
 * something ugly.
 */
export function fallbackAgreementName(contextId: string): string {
  const id = clean(contextId);
  return id ? `Agreement ${id.slice(0, 8)}…` : 'Untitled agreement';
}

/** True for the generic words earlier builds stored instead of a real name. */
export function isPlaceholderName(
  value: string | null | undefined,
  contextId?: string,
): boolean {
  const name = clean(value);
  if (!name) return true;
  if (PLACEHOLDERS.has(name.toLowerCase())) return true;
  // The fallback shape itself: `Agreement 1a2b3c4d…`, from this module or from
  // the older `Agreement 1a2b3c4d...` in agreementService.
  if (/^agreement\s+[0-9a-z]{4,}(…|\.\.\.)$/i.test(name)) return true;
  if (contextId && name === contextId) return true;
  return false;
}

export interface AgreementNameSources {
  /** `get_context_details().context_name` from the SHARED context. Replicated. */
  fromContract?: string | null;
  /** The name carried in the invitation. Untrusted display hint. */
  fromInvitation?: string | null;
  /** Whatever this node already had recorded, e.g. a private-context snapshot. */
  stored?: string | null;
  contextId: string;
}

/**
 * Resolve the name to show (and to record) for an agreement.
 *
 * Order, and why:
 *
 *   1. **the contract**, because it is the same on every node by construction;
 *   2. **the invitation's hint**, because while the shared context is still
 *      syncing it is the inviter's own words and is strictly better than a
 *      generic label — but it is outside the signature, so it never beats (1);
 *   3. **whatever was already stored**, unless it is one of the generic
 *      placeholders earlier builds wrote, in which case it carries no
 *      information and we would rather show the id;
 *   4. **`Agreement <id-prefix>…`**, which at least distinguishes rows.
 */
export function resolveAgreementName(sources: AgreementNameSources): string {
  const fromContract = clean(sources.fromContract);
  if (fromContract && !isPlaceholderName(fromContract, sources.contextId)) {
    return fromContract;
  }

  const fromInvitation = clean(sources.fromInvitation);
  if (fromInvitation && !isPlaceholderName(fromInvitation, sources.contextId)) {
    return fromInvitation;
  }

  const stored = clean(sources.stored);
  if (stored && !isPlaceholderName(stored, sources.contextId)) {
    return stored;
  }

  // A contract name that IS a placeholder still beats inventing one: the creator
  // may genuinely have called it "Agreement", and at that point every node
  // agrees, which is the property we care about.
  return fromContract ?? fallbackAgreementName(sources.contextId);
}
