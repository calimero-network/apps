// ── Where you were last ─────────────────────────────────────────────────────
//
// Opening the app used to land on the teams list every time, then a team, then
// a project: three screens to get back to the canvas you closed. A cold open
// now resumes there instead (the pattern mero-design's utils/lastVisit set).
//
// What is remembered is scoped to the NODE: one browser can sign in to several
// nodes, and a team id from one means nothing on another. It is only a hint:
// every read is checked against what this node lists right now, and an entry
// it no longer lists (a team you left, a project someone deleted) is
// forgotten, so a stale one never opens a screen that can only fail.

import type { Location } from "react-router-dom";

export interface LastVisit {
  /** The team open last. */
  team?: string;
  /** The project open last in each team, by team id. */
  projects?: Record<string, string>;
}

const PREFIX = "mp-last-visit:";

/** The storage key for one node. Exported for tests. */
export function lastVisitKey(nodeUrl: string | null | undefined): string {
  return `${PREFIX}${(nodeUrl ?? "").replace(/\/+$/, "") || "local"}`;
}

export function readLastVisit(nodeUrl: string | null | undefined): LastVisit {
  try {
    const raw = localStorage.getItem(lastVisitKey(nodeUrl));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as LastVisit) : {};
  } catch {
    // Blocked storage or a corrupt entry is a cold start, not a failure.
    return {};
  }
}

function write(nodeUrl: string | null | undefined, next: LastVisit): void {
  try {
    localStorage.setItem(lastVisitKey(nodeUrl), JSON.stringify(next));
  } catch {
    /* quota / private mode: forgetting is fine */
  }
}

export function rememberTeam(nodeUrl: string | null | undefined, teamId: string): void {
  if (!teamId) return;
  const cur = readLastVisit(nodeUrl);
  if (cur.team === teamId) return;
  write(nodeUrl, { ...cur, team: teamId });
}

export function rememberProject(nodeUrl: string | null | undefined, teamId: string, projectId: string): void {
  if (!teamId || !projectId) return;
  const cur = readLastVisit(nodeUrl);
  if (cur.team === teamId && cur.projects?.[teamId] === projectId) return;
  write(nodeUrl, { ...cur, team: teamId, projects: { ...cur.projects, [teamId]: projectId } });
}

/** Forget a team (left, deleted, or no longer listed) and its last project. */
export function forgetTeam(nodeUrl: string | null | undefined, teamId: string): void {
  const cur = readLastVisit(nodeUrl);
  if (cur.team !== teamId && !cur.projects?.[teamId]) return;
  const projects = { ...cur.projects };
  delete projects[teamId];
  write(nodeUrl, { ...cur, team: cur.team === teamId ? undefined : cur.team, projects });
}

/** Forget a team's last project (deleted, or no longer listed). */
export function forgetProject(nodeUrl: string | null | undefined, teamId: string, projectId: string): void {
  const cur = readLastVisit(nodeUrl);
  if (cur.projects?.[teamId] !== projectId) return;
  const projects = { ...cur.projects };
  delete projects[teamId];
  write(nodeUrl, { ...cur, projects });
}

/** Everything remembered for a node: a logout starts the next sign-in cold. */
export function clearLastVisit(nodeUrl: string | null | undefined): void {
  try {
    localStorage.removeItem(lastVisitKey(nodeUrl));
  } catch {
    /* blocked storage holds nothing to clear */
  }
}

/**
 * The remembered id if this node still lists it, else none. Never a guess:
 * with nothing (valid) remembered the list is shown and you choose.
 */
export function pickRemembered(listed: readonly string[], remembered: string | undefined): string | null {
  return remembered && listed.includes(remembered) ? remembered : null;
}

/** This navigation asked to go on to where you were last (`state.resume`). */
export function resumeRequested(location: Pick<Location, "state">): boolean {
  return (location.state as { resume?: boolean } | null)?.resume === true;
}

/**
 * Whether arriving on the teams list should go on to where you were last.
 *
 * Only for the app's own default redirect (sign-in, `/`), which says so with
 * `state.resume`. Every other arrival is a visit to the list you chose: the
 * "← Teams" link, Back, and the first page of a load too — a reload of the
 * list, or a typed `/teams`, must not bounce you straight back out. The page
 * replaces the entry once it has resolved it, so a later visit is a plain one.
 */
export function shouldResume(location: Pick<Location, "state">): boolean {
  return resumeRequested(location);
}
