// Admin-only: propagate namespace membership into every Inherit-mode
// folder.
//
// The server treats folder subgroup membership as strictly explicit —
// a user joining the namespace root does NOT gain access to any
// subgroup, even one marked `visibility: "Inherit"`. "Inherit" is a
// UI-level convention (we store it on the Registry FolderDto), not a
// server-side auth policy.
//
// This hook bridges that gap: for every namespace member and every
// Inherit folder, ensure the member is on the folder's member list.
// Run explicitly by an admin (Workspace Settings → "Cascade inherit
// access") after invites, because:
//   - The joining user themselves can't add themselves (they have no
//     MANAGE_MEMBERS on child folders).
//   - Automatic-on-join cascade would require the admin's tab to be
//     open and watching for join events — fragile.
//
// Idempotent: checks existing membership per folder before adding.

import { useCallback, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { useDriveWorkspace } from './useDriveWorkspace';

export interface CascadeResult {
  folders: number;
  members: number;
  added: number;
  skipped: number;
  failures: number;
}

export interface UseInheritCascadeState {
  running: boolean;
  last: CascadeResult | null;
  error: Error | null;
  run: () => Promise<CascadeResult | null>;
}

export function useInheritCascade(): UseInheritCascadeState {
  const { mero } = useMero();
  const { rootGroupId, folders } = useDriveWorkspace();
  const [state, setState] = useState<Omit<UseInheritCascadeState, 'run'>>({
    running: false,
    last: null,
    error: null,
  });

  const run = useCallback(async (): Promise<CascadeResult | null> => {
    if (!mero || !rootGroupId) return null;
    setState((s) => ({ ...s, running: true, error: null }));
    try {
      // 1) Namespace members. Cast through unknown — wire shape uses
      //    `data` or `members` depending on backend version.
      const nsRaw = (await mero.admin.listGroupMembers(
        rootGroupId,
      )) as unknown as {
        members?: Array<{ identity: string; role?: string }>;
        data?: Array<{ identity: string; role?: string }>;
      };
      const namespaceMembers = nsRaw.members ?? nsRaw.data ?? [];

      // 2) Inherit-mode folders from the merged registry/admin tree.
      const inheritFolders = folders.filter(
        (f) => f.visibility === 'Inherit',
      );

      let added = 0;
      let skipped = 0;
      let failures = 0;

      // 3) For each folder, read existing members, diff against
      //    namespace members, add the missing ones.
      for (const folder of inheritFolders) {
        let existing: Set<string>;
        try {
          const fRaw = (await mero.admin.listGroupMembers(
            folder.id,
          )) as unknown as {
            members?: Array<{ identity: string }>;
            data?: Array<{ identity: string }>;
          };
          existing = new Set((fRaw.members ?? fRaw.data ?? []).map((m) => m.identity));
        } catch {
          // If we can't read the folder's members we can't diff.
          // Skip and surface via failures count rather than aborting.
          failures += 1;
          continue;
        }

        for (const member of namespaceMembers) {
          if (existing.has(member.identity)) {
            skipped += 1;
            continue;
          }
          try {
            await mero.admin.addGroupMembers(folder.id, {
              members: [{ identity: member.identity, role: 'member' }],
            });
            added += 1;
          } catch {
            failures += 1;
          }
        }
      }

      const result: CascadeResult = {
        folders: inheritFolders.length,
        members: namespaceMembers.length,
        added,
        skipped,
        failures,
      };
      setState({ running: false, last: result, error: null });
      return result;
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setState({ running: false, last: null, error: err });
      return null;
    }
  }, [mero, rootGroupId, folders]);

  return { ...state, run };
}
