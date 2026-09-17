import { adminGet } from "./rpc";

// ── Every board in a team ────────────────────────────────────────────────────
//
// Team settings has no context in scope — it is a namespace screen — but canvas
// access lives in each board's contract. So a governance change that has to
// reach the canvas (Admin implies edit, and therefore demotion must take it
// away) has to enumerate the team's boards first.
//
// Two hops, because a board is a context inside a subgroup:
//   /groups/{teamId}/subgroups  →  /groups/{subgroupId}/contexts
//
// Both routes have been returning three different envelope shapes across
// releases, so the parsing is deliberately tolerant and kept pure — that is the
// part worth testing, and the part that quietly returns [] when a shape moves.

interface SubgroupRaw {
  groupId?: string;
  group_id?: string;
  id?: string;
}

interface ContextRaw {
  contextId?: string;
  context_id?: string;
  id?: string;
}

type SubgroupsResponse =
  | SubgroupRaw[]
  | { subgroups?: SubgroupRaw[]; data?: SubgroupRaw[] };

type ContextsResponse =
  | ContextRaw[]
  | { contexts?: ContextRaw[]; items?: ContextRaw[]; data?: ContextRaw[] };

/** Subgroup ids out of any envelope the route has used. */
export function parseSubgroupIds(raw: SubgroupsResponse | null | undefined): string[] {
  const list = Array.isArray(raw) ? raw : raw?.subgroups ?? raw?.data ?? [];
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => s?.groupId ?? s?.group_id ?? s?.id ?? "")
    .filter((id): id is string => !!id);
}

/** Context ids out of any envelope the route has used. */
export function parseContextIds(raw: ContextsResponse | null | undefined): string[] {
  const list = Array.isArray(raw)
    ? raw
    : raw?.contexts ?? raw?.items ?? raw?.data ?? [];
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => c?.contextId ?? c?.context_id ?? c?.id ?? "")
    .filter((id): id is string => !!id);
}

/**
 * Every board context in a team. A subgroup with no context yet is skipped
 * rather than failing the whole walk — half a team's boards is still better
 * than none when one subgroup is mid-creation.
 */
export async function listTeamContexts(teamId: string): Promise<string[]> {
  let subgroupIds: string[] = [];
  try {
    subgroupIds = parseSubgroupIds(
      await adminGet<SubgroupsResponse>(`/groups/${teamId}/subgroups`),
    );
  } catch {
    return [];
  }

  const contexts: string[] = [];
  for (const groupId of subgroupIds) {
    try {
      contexts.push(
        ...parseContextIds(
          await adminGet<ContextsResponse>(`/groups/${groupId}/contexts`),
        ),
      );
    } catch {
      // No context in this subgroup yet.
    }
  }
  return contexts;
}
