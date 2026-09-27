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
  listed: string[];
  routeNs: string | null;
  stored: string | null;
  justJoined: Set<string>;
  created: string | null;
}

/** Where the URL should move (with replace) and which id to remember, if any. */
export function syncWorkspaceRoute(i: RouteSyncInput): {
  goTo: string | null;
  remember: string | null;
} {
  // Holds the URL for a just-joined id not yet listed, or a link to a
  // workspace this node isn't in at all, instead of swapping it silently.
  const routeUnresolved =
    !!i.routeNs &&
    ((i.justJoined.has(i.routeNs) && !i.listed.includes(i.routeNs)) ||
      (i.listed.length > 0 &&
        !i.listed.includes(i.routeNs) &&
        i.routeNs !== i.created));
  if (routeUnresolved) return { goTo: null, remember: null };

  const next = nextNamespaceSelection({
    listed: i.listed,
    selected: i.routeNs ?? i.stored,
    justJoined: i.justJoined,
    created: i.created,
    remembered: i.stored,
  });
  return {
    goTo: next && next !== i.routeNs ? next : null,
    // An unconfirmed link must not overwrite the fallback it may need.
    remember: next && i.listed.includes(next) && next !== i.stored ? next : null,
  };
}
