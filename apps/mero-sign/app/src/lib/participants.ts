// ── Participants and what they are allowed to do ─────────────────────────────
//
// Pure helpers for the roles panel. The rules encoded here mirror the contract
// exactly, and where the contract refuses something this says so rather than
// offering a control that quietly does nothing.
//
// ⚠️ IDS ARE HEX. Core 0.11.0-rc.27 removed base58 from ids entirely, and the
// contract's `parse_public_key_hex` decodes hex. The participants panel used to
// render `bs58.encode(user_id)` — so every id on screen was in an encoding the
// contract would reject, and copying one into the "invite one person" box gave
// `contained invalid character '0' at byte 1` (base58 has no `0`; that is what
// a hex id looks like to a base58 decoder).
//
// ⚠️ These ids are ACCOUNTS, not devices. `init`,
// `register_self_as_participant` and `permissions` are all keyed by
// `env::account_id()`. Since rc.27 an account id and a context member (device)
// key are both 32 raw bytes — 64 hex characters — so the two are
// indistinguishable by inspection and comparing the wrong pair type-checks and
// silently matches nothing. The contract's `whoami()` is the only reliable way
// for this app to learn its own ACCOUNT, which is why it exists.

import type { ParticipantInfo, UserId } from '../api/clientApi';
import { PermissionLevel } from '../api/clientApi';

/**
 * Normalise an id the contract handed back into the hex string the contract
 * takes. `UserId` arrives as a byte array from a contract call and as a string
 * from anything that has already been through here.
 */
export function toHexId(value: string | number[] | Uint8Array): string {
  if (typeof value === 'string') return value.trim().toLowerCase();
  const bytes = Array.isArray(value) ? value : Array.from(value);
  return bytes.map((b) => Number(b).toString(16).padStart(2, '0')).join('');
}

/** A 32-byte hex id, the only thing the contract's parsers accept. */
export function isHexId(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value.trim().toLowerCase());
}

/** Shortened for display, keeping both ends so two ids stay distinguishable. */
export function shortId(value: string): string {
  const id = toHexId(value);
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

/** Rank, matching `PermissionCell::rank` in the contract. Admin > Sign > Read. */
export function rankOf(level: PermissionLevel): number {
  switch (level) {
    case PermissionLevel.Admin:
      return 2;
    case PermissionLevel.Sign:
      return 1;
    default:
      return 0;
  }
}

/** What each level actually lets you do, in this contract, today. */
export const LEVEL_DESCRIPTIONS: Record<PermissionLevel, string> = {
  [PermissionLevel.Read]: 'Can open the agreement and read its documents.',
  [PermissionLevel.Sign]: 'Can upload documents and sign them.',
  [PermissionLevel.Admin]:
    'Everything a signer can do, plus deleting documents and managing who is in the agreement.',
};

/**
 * The levels an admin may move someone UP to.
 *
 * Only upward: `set_participant_permission` refuses a demotion, because
 * `PermissionCell` merges by taking the higher rank, so a lowered level is
 * discarded the moment it meets a replica that still holds the old one. A
 * "Demote" button would look like it withdrew authority and would not have.
 * Withdrawing authority converges only through removal.
 */
export function promotionsFor(current: PermissionLevel): PermissionLevel[] {
  const rank = rankOf(current);
  return [PermissionLevel.Sign, PermissionLevel.Admin].filter(
    (level) => rankOf(level) > rank,
  );
}

/** Why a demotion is not offered, in words a user can act on. */
export const DEMOTION_UNAVAILABLE =
  'Permissions can be raised but not lowered: they merge by taking the higher level, ' +
  'so a downgrade would apply on your node and nowhere else. Remove the person instead — ' +
  'removals do reach every node.';

export interface RosterEntry {
  /** The participant's ACCOUNT id, hex. */
  id: string;
  level: PermissionLevel;
  isSelf: boolean;
}

/**
 * The roster as the panel renders it: admins first, then signers, then readers,
 * and `selfAccountId` marked so the UI never offers someone a control over
 * themselves that the contract would accept but that makes no sense.
 *
 * `selfAccountId` comes from the contract's `whoami()`. Passing "" (the answer
 * before it has replied, or on a node too old to have the method) marks nobody
 * as self, which is the safe reading — the UI then shows no self-badge rather
 * than badging the wrong row.
 */
export function buildRoster(
  participants: readonly ParticipantInfo[],
  selfAccountId: string,
): RosterEntry[] {
  const me = selfAccountId ? toHexId(selfAccountId) : '';
  return participants
    .map((p) => {
      const id = toHexId(p.user_id as unknown as UserId);
      return {
        id,
        level: p.permission_level ?? PermissionLevel.Read,
        isSelf: !!me && id === me,
      };
    })
    .sort(
      (a, b) => rankOf(b.level) - rankOf(a.level) || a.id.localeCompare(b.id),
    );
}

/** Whether this account may manage participants — i.e. is an Admin. */
export function isAdmin(
  roster: readonly RosterEntry[],
  selfAccountId: string,
): boolean {
  if (!selfAccountId) return false;
  const me = toHexId(selfAccountId);
  return roster.some(
    (entry) => entry.id === me && entry.level === PermissionLevel.Admin,
  );
}

/**
 * Whether removing this person is offered.
 *
 * Never yourself — an admin removing themselves cannot undo it, because
 * `add_participant` needs an admin and there may be none left. And never the
 * last admin, for the same reason.
 */
export function canRemove(
  roster: readonly RosterEntry[],
  target: RosterEntry,
): boolean {
  if (target.isSelf) return false;
  if (target.level !== PermissionLevel.Admin) return true;
  return roster.filter((e) => e.level === PermissionLevel.Admin).length > 1;
}
