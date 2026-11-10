// A workspace's folders, read from its organization's teams.
//
// A folder is a team of the workspace's org: its name is the team's name, its
// colour the team metadata's `color`, its documents the app instance whose id
// the team metadata keeps as `docsApp`, and Open / Restricted the team's
// `join` (everyone / invite). Core answers `GET /orgs/{org}` with only the
// teams the caller reaches or manages, so a Restricted folder someone was not
// invited to is not there at all; one they were invited to below a parent
// they cannot see comes back `shared`, with no parent.

import { DOCS_APP_KEY, isAppTeam, type OrgAdmin, type OrgView, type TeamView } from '@/calimero/orgs';

/** Where a folder's colour lives in its team's metadata. */
export const FOLDER_COLOR_KEY = 'color';

export interface CoreFolder {
  id: string;
  /** The folder above, or null for a top-level one and for a Shared one. */
  parent_id: string | null;
  color: string | null;
  /** The team's name; null when it has none. */
  alias: string | null;
  /** The folder's docs instance; null until one is created. */
  context_id: string | null;
  visibility: 'Open' | 'Restricted' | undefined;
  /** Restricted when this folder or one above it (that the caller sees) is. */
  effectiveVisibility?: 'Open' | 'Restricted';
  /** Reached without seeing the folder above it. */
  shared: boolean;
}

export type FolderReader = Pick<OrgAdmin, 'listGroupContexts'>;

/** A folder's docs instance, or null. */
export async function folderDocsContext(admin: FolderReader, folderId: string): Promise<string | null> {
  const contexts = await admin.listGroupContexts(folderId);
  return contexts[0]?.contextId ?? null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Every folder of `org` this caller sees, from one snapshot. */
export function foldersOf(org: OrgView): CoreFolder[] {
  const teams = org.teams;
  const restricted = (t: TeamView): boolean => {
    for (let at: TeamView | undefined = t; at; at = at.parent ? teams[at.parent] : undefined) {
      if (at.join === 'invite') return true;
    }
    return false;
  };
  // An app's own team (Docs' or another app's, core#4890) is not a folder.
  return Object.values(teams).filter((t) => !isAppTeam(t)).map((t) => {
    const hiddenParent = !!t.parent && !teams[t.parent];
    return {
      id: t.teamId,
      parent_id: hiddenParent ? null : t.parent,
      color: text(t.metadata[FOLDER_COLOR_KEY]),
      alias: t.name || null,
      context_id: text(t.metadata[DOCS_APP_KEY]),
      visibility: t.join === 'invite' ? 'Restricted' : 'Open',
      effectiveVisibility: restricted(t) ? 'Restricted' : 'Open',
      shared: hiddenParent,
    };
  });
}

/** Every folder of the workspace `orgId` this caller sees. */
export async function loadCoreFolders(admin: Pick<OrgAdmin, 'org'>, orgId: string): Promise<CoreFolder[]> {
  return foldersOf(await admin.org(orgId, true));
}
