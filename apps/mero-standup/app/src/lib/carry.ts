import type { UpdateView } from "../generated/StandupClient";

export interface Draft {
  done: string;
  next: string;
  blockers: string;
}

export const EMPTY_DRAFT: Draft = { done: "", next: "", blockers: "" };

/**
 * Today's starting point from your last update: what you said was NEXT is
 * most likely what got DONE, and a blocker usually outlives a day. Nothing is
 * posted until you press Post — this only fills the form.
 */
export function carryForward(last: UpdateView | null): Draft {
  if (!last) return EMPTY_DRAFT;
  return { done: last.next, next: "", blockers: last.blockers };
}
