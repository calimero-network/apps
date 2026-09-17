// The roster, as the UI needs it — pure so the fiddly parts are testable.
//
// "Who is in the room" comes from the CONTRACT (`get_members`: everyone who ever
// joined, with the name they joined under) while "who is broadcasting" comes from
// the PRESENCE traffic (a frame in the last few seconds). The two are genuinely
// different questions with different sources, and conflating them is how you get
// a roster that shows a departed peer as live, or a broadcaster who never called
// `join` as absent.

/** One participant, as the roster renders them. */
export interface Person {
  memberId: string;
  name: string;
  /** Currently publishing media — from presence traffic, not the contract. */
  live: boolean;
  isSelf: boolean;
}

/**
 * Two-character avatar initials.
 *
 * First + last word for a multi-word name, first two letters for one word. Never
 * empty: an avatar with no glyph reads as a rendering bug, so an unusable name
 * falls back to "??" rather than to blank.
 *
 * Uses `Array.from` and not `slice`, because a name can begin with an astral
 * character (an emoji, or a character outside the BMP) and `"👋x".slice(0, 2)`
 * splits a surrogate pair into a replacement glyph.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  const first = Array.from(words[0]);
  if (words.length === 1) {
    return first.slice(0, 2).join("").toUpperCase();
  }
  const last = Array.from(words[words.length - 1]);
  return (first[0] + last[0]).toUpperCase();
}

/**
 * Fold the contract roster together with who is actually broadcasting.
 *
 * `liveIds` are remote senders observed in the media stream. Our own broadcast
 * state is passed separately (`selfLive`) rather than looked up there, because we
 * never decode our own echo — so we are never in `liveIds` even while live.
 *
 * `selfName` overrides whatever the contract has for us. A rename is local and
 * instant; the contract roster catches up on its next poll, and showing the user
 * their old name for ten seconds after they changed it reads as the rename having
 * failed.
 */
export function buildRoster(args: {
  members: readonly { memberId: string; name: string }[];
  liveIds: ReadonlySet<string>;
  me: string;
  selfName: string;
  selfLive: boolean;
}): Person[] {
  const { members, liveIds, me, selfName, selfLive } = args;

  const rows: Person[] = members.map((m) => ({
    memberId: m.memberId,
    name: m.memberId === me ? selfName : m.name,
    live: m.memberId === me ? selfLive : liveIds.has(m.memberId),
    isSelf: m.memberId === me,
  }));

  // A sender we have never seen in the roster is still a person on screen. This
  // happens for real: the contract roster is a poll behind, so someone who joins
  // and immediately broadcasts has a tile before they have a row.
  //
  // Set membership rather than `rows.some(...)` per id: the linear scan made this
  // O(members x live), which is nothing at this app's scale but is the kind of
  // shape that quietly stops being nothing if the roster is ever reused.
  const known = new Set(rows.map((r) => r.memberId));
  for (const id of liveIds) {
    if (known.has(id)) continue;
    rows.push({ memberId: id, name: shortId(id), live: true, isSelf: false });
  }

  // Ourselves first, then live, then by name — so the list answers "who is
  // talking" before "who is here", and never reorders on a re-render.
  return rows.sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    if (a.live !== b.live) return a.live ? -1 : 1;
    return a.name.localeCompare(b.name) || a.memberId.localeCompare(b.memberId);
  });
}

/** A member id shortened for display when no name is known yet. */
export function shortId(memberId: string): string {
  return `${memberId.slice(0, 8)}…`;
}
