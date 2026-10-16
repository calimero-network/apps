// Which namespace the workspace shows, given what the node lists. Extracted
// from `useDriveWorkspace` so the fallback rules can be asserted.

export interface SelectionInput {
  listed: string[];
  selected: string | null;
  justJoined: Set<string>;
  created: string | null;
  /** The last workspace used on this device, the fallback before `listed[0]`. */
  remembered: string | null;
}

/** The id to select next; `selected` itself when nothing should change. */
export function nextNamespaceSelection(i: SelectionInput): string | null {
  if (i.listed.length === 0) return i.selected;
  const joined = i.listed.find((id) => i.justJoined.has(id));
  if (joined) return joined;
  if (i.selected && i.listed.includes(i.selected)) return i.selected;
  // The list can predate the create: a concurrent refetch supersedes the
  // create's own read. Wait for a list that shows it instead of falling back.
  if (i.selected && i.selected === i.created) return i.selected;
  if (i.remembered && i.listed.includes(i.remembered)) return i.remembered;
  return i.listed[0];
}

export interface RouteSyncInput {
  /** The node has answered the list read; until then `listed` is `[]`, not "none". */
  answered: boolean;
  listed: string[];
  routeNs: string | null;
  /** The workspace remembered on this node (see `rememberedOn`). */
  stored: string | null;
  justJoined: Set<string>;
  created: string | null;
}

/** Where the URL should move (with replace), which id to remember, and
 *  whether the remembered id is one this node does not hold. */
export function syncWorkspaceRoute(i: RouteSyncInput): {
  goTo: string | null;
  remember: string | null;
  forget: boolean;
} {
  // An unanswered list says nothing, and a remembered id this node has never
  // confirmed must not reach the URL (and every group read behind it).
  if (!i.answered) return { goTo: null, remember: null, forget: false };
  const forget =
    !!i.stored &&
    !i.listed.includes(i.stored) &&
    !i.justJoined.has(i.stored) &&
    i.stored !== i.created;
  const stored = forget ? null : i.stored;

  // Holds the URL for a just-joined id not yet listed, or a link to a
  // workspace this node isn't in at all, instead of swapping it silently.
  const routeUnresolved =
    !!i.routeNs &&
    ((i.justJoined.has(i.routeNs) && !i.listed.includes(i.routeNs)) ||
      (i.listed.length > 0 &&
        !i.listed.includes(i.routeNs) &&
        i.routeNs !== i.created));
  if (routeUnresolved) return { goTo: null, remember: null, forget };

  const next = nextNamespaceSelection({
    listed: i.listed,
    selected: i.routeNs ?? stored,
    justJoined: i.justJoined,
    created: i.created,
    remembered: stored,
  });
  return {
    goTo: next && next !== i.routeNs ? next : null,
    // An unconfirmed link must not overwrite the fallback it may need.
    remember: next && i.listed.includes(next) && next !== i.stored ? next : null,
    forget,
  };
}

/**
 * The routed workspace, once this node is known to hold it; null otherwise.
 * Every group read is keyed by this, and a node answers an id it does not
 * hold with 404 "group not found". A just-joined or just-created id is trusted
 * before the list shows it, as the post-join and create flows need.
 */
export function confirmedNamespace(i: Omit<RouteSyncInput, 'stored'>): string | null {
  const ns = i.routeNs;
  if (!ns) return null;
  if (i.justJoined.has(ns) || ns === i.created) return ns;
  return i.answered && i.listed.includes(ns) ? ns : null;
}

/** The last workspace used, and the node it was used on (null when unknown). */
export interface RememberedNamespace {
  node: string | null;
  ns: string;
}

/** The stored value: `{ node, ns }`, or the bare id older builds wrote. */
export function parseRemembered(value: unknown): RememberedNamespace | null {
  if (typeof value === 'string') return value ? { node: null, ns: value } : null;
  if (!value || typeof value !== 'object') return null;
  const { node, ns } = value as { node?: unknown; ns?: unknown };
  if (typeof ns !== 'string' || !ns) return null;
  return { node: typeof node === 'string' ? node : null, ns };
}

/** The remembered workspace when it was used on `node`. An unscoped (older)
 *  id is offered too: the list read still has to confirm it on this node. */
export function rememberedOn(value: unknown, node: string | null): string | null {
  const r = parseRemembered(value);
  return r && (r.node === null || r.node === node) ? r.ns : null;
}
