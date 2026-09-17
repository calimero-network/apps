import type { Member } from "../types";
import { shortId } from "./people";

/**
 * Who is in a room, by the name they chose.
 *
 * The room rows used to show a member COUNT and nothing else — "3 members" — so
 * after inviting someone there was no way to see whether they had arrived, let
 * alone who they were. And where identities did surface they were raw 64-hex
 * member ids, which answer no question anyone actually has.
 *
 * The contract already stores the nickname each member picked (`Member.username`,
 * set by `join`), so the name is there to be read; nothing was reading it.
 */

/** A member, resolved to something worth putting on screen. */
export interface RoomMemberLabel {
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
 * A blank username is a real state — someone can be in a context before they
 * have opened the room and chosen a name — so it falls back to a short id
 * rather than rendering an empty chip. The fallback is flagged so the UI can
 * style it as the placeholder it is instead of passing it off as a name.
 */
export function memberLabel(member: Member, selfId: string): RoomMemberLabel {
  const name = (member.username ?? "").trim();
  return {
    memberId: member.memberId,
    label: name || shortId(member.memberId),
    anonymous: name.length === 0,
    isSelf: !!selfId && member.memberId === selfId,
  };
}

/**
 * Label a whole roster, self first then by name.
 *
 * Self first because "am I in this room" is the question the list answers most
 * often, and a stable order because these rows re-render on every poll — a list
 * that reshuffles under the pointer is worse than no list.
 */
export function labelMembers(
  members: readonly Member[],
  selfId: string,
): RoomMemberLabel[] {
  return members
    .map((m) => memberLabel(m, selfId))
    .sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      // Named members before anonymous ones: a name is information, an id is
      // not, and burying the names under placeholders defeats the point.
      if (a.anonymous !== b.anonymous) return a.anonymous ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
}

/**
 * Render a roster as a short line, with an overflow count.
 *
 * `max` keeps a busy room from pushing the row's controls off screen. The
 * remainder is counted rather than dropped, because "+4" is the difference
 * between a truncated list and a wrong one.
 */
export function summariseMembers(
  labels: readonly RoomMemberLabel[],
  max = 3,
): string {
  if (labels.length === 0) return "";
  const shown = labels.slice(0, max).map((l) => (l.isSelf ? "You" : l.label));
  const rest = labels.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest}` : shown.join(", ");
}
