// Turning a 64-hex device key into something worth putting on screen.
//
// The collaborator bar used to label every avatar with `author.slice(0, 2)` —
// the first two characters of a hex key. Two people whose keys both begin "3a"
// got the same badge, nobody's badge meant anything, and the tooltip was the
// full 64-hex string. The contract now stores the nickname each collaborator
// chose (`Member.nickname`, written by `join`), so there is a name to show; this
// module is the mapping from "what the contract has" to "what the UI renders",
// kept pure so the fiddly parts are testable without a node.

import type { Member } from '../api/spreadsheet/SpreadsheetClient';

/**
 * Two-character avatar initials.
 *
 * First + last word for a multi-word name, first two letters for one word.
 * Never empty: an avatar with no glyph reads as a rendering bug, so an unusable
 * name falls back to "??" rather than to blank.
 *
 * Uses `Array.from` and not `slice`, because a name can begin with an astral
 * character (an emoji, or anything outside the BMP) and `"👋x".slice(0, 2)`
 * splits a surrogate pair into a replacement glyph.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  const first = Array.from(words[0]);
  if (words.length === 1) {
    return first.slice(0, 2).join('').toUpperCase();
  }
  const last = Array.from(words[words.length - 1]);
  return (first[0] + last[0]).toUpperCase();
}

/** A member id shortened for display when no name is known yet. */
export function shortId(memberId: string): string {
  return `${memberId.slice(0, 8)}…`;
}

/** A collaborator, resolved to something worth putting on screen. */
export interface PersonLabel {
  memberId: string;
  /** The chosen nickname, or a short id when they have not picked one. */
  label: string;
  /** True when this member has no nickname, so `label` is a fallback id. */
  anonymous: boolean;
  isSelf: boolean;
}

/**
 * Label one member.
 *
 * A blank nickname is a real state — someone is in a context from the moment
 * they join it, which is before they have opened the spreadsheet and chosen a
 * name — so it falls back to a short id rather than rendering an empty chip. The
 * fallback is FLAGGED rather than passed off as a name, so the UI can style it
 * as the placeholder it is; a truncated key rendered in the same weight as a
 * real name is a worse lie than the full key was.
 */
export function memberLabel(
  member: Pick<Member, 'id' | 'nickname'>,
  selfId: string | null,
): PersonLabel {
  const name = (member.nickname ?? '').trim();
  return {
    memberId: member.id,
    label: name || shortId(member.id),
    anonymous: name.length === 0,
    isSelf: !!selfId && member.id === selfId,
  };
}

/**
 * Label a whole roster: self first, then named members, then placeholders.
 *
 * Self first because "am I in here" is the question the list answers most often.
 * Named before anonymous because a name is information and an id is not, and
 * burying the names under placeholders defeats the point. A total order, because
 * these rows re-render on every sync event and a list that reshuffles under the
 * pointer is worse than no list.
 */
export function labelMembers(
  members: readonly Pick<Member, 'id' | 'nickname'>[],
  selfId: string | null,
): PersonLabel[] {
  return members
    .map((m) => memberLabel(m, selfId))
    .sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      if (a.anonymous !== b.anonymous) return a.anonymous ? 1 : -1;
      return a.label.localeCompare(b.label) || a.memberId.localeCompare(b.memberId);
    });
}

/**
 * Index a roster by member id, for labelling something keyed the same way.
 *
 * A live cursor carries its publisher's member id (`whoami`, which is
 * `hex(device_id)`) and `Member.id` is the same value, deliberately — so a
 * cursor can be labelled with the name its author chose without a translation
 * step anywhere.
 */
export function labelsById(
  labels: readonly PersonLabel[],
): Map<string, PersonLabel> {
  return new Map(labels.map((l) => [l.memberId, l]));
}

/**
 * Render a roster as a short line, with an overflow count.
 *
 * `max` keeps a busy spreadsheet from pushing the bar's controls off screen. The
 * remainder is counted rather than dropped, because "+4" is the difference
 * between a truncated list and a wrong one.
 */
export function summariseMembers(
  labels: readonly PersonLabel[],
  max = 3,
): string {
  if (labels.length === 0) return '';
  const shown = labels.slice(0, max).map((l) => (l.isSelf ? 'You' : l.label));
  const rest = labels.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} +${rest}` : shown.join(', ');
}
