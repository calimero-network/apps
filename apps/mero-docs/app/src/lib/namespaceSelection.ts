// Which namespace the workspace shows, given what the node lists. Extracted
// from `useDriveWorkspace` so the fallback rules can be asserted.

export interface SelectionInput {
  listed: string[];
  selected: string | null;
  justJoined: Set<string>;
  created: string | null;
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
  return i.listed[0];
}
