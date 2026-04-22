// Idempotent drift resolver between admin-API groups (source of
// truth for the subgroup tree) and registry state (source of truth
// for folder metadata). `computeReconcileActions` — the pure diff —
// was tested as part of Phase 5; this hook wires the fetches and
// applies the actions via the generated RegistryClient.
//
// Callers pass in:
//   - rootGroupId: namespace root group (excluded from the diff)
//   - registryClient: built by useRegistryClient; null while ctx
//     bootstraps
//   - adminSubgroups: flat subgroup list from useSubgroups(rootGroupId)
//
// `run()` is async and returns the summary of what it did. Failure
// on any individual register/unregister/move is surfaced as the
// promise's error — the partial state of registry is left as-is
// (next reconcile will converge further).

import { useCallback, useState } from 'react';
import type { SubgroupEntry } from '@calimero-network/mero-react';
import type { RegistryClient } from '../api/registry/RegistryClient';
import { computeReconcileActions, AdminGroup } from '../utils/reconcile';

export interface ReconcileResult {
  registered: number;
  unregistered: number;
  moved: number;
}

export interface UseReconcileState {
  running: boolean;
  last: ReconcileResult | null;
  error: Error | null;
  run: () => Promise<ReconcileResult | null>;
}

export function useReconcile(
  rootGroupId: string | null,
  registryClient: RegistryClient | null,
  adminSubgroups: SubgroupEntry[],
): UseReconcileState {
  const [state, setState] = useState<Omit<UseReconcileState, 'run'>>({
    running: false,
    last: null,
    error: null,
  });

  const run = useCallback(async (): Promise<ReconcileResult | null> => {
    if (!rootGroupId || !registryClient) return null;
    setState((s) => ({ ...s, running: true }));
    try {
      const regFolders = await registryClient.getFolders();
      // SubgroupEntry doesn't carry parent_id; registry does.
      // We cross-reference: if registry has the folder, use its
      // parent_id; otherwise default to rootGroupId (the "newly seen
      // by admin, not yet in registry" case — reconcile will
      // register_folder with parent_id=root).
      const regById = new Map(regFolders.map((f) => [f.id, f]));
      const admin: AdminGroup[] = adminSubgroups.map((s) => ({
        id: s.groupId,
        parent_id: regById.get(s.groupId)?.parent_id ?? rootGroupId,
        alias: s.alias,
      }));
      const regShape = regFolders.map((f) => ({
        id: f.id,
        parent_id: f.parent_id ?? null,
      }));
      const actions = computeReconcileActions(admin, regShape, rootGroupId);

      for (const r of actions.register) {
        await registryClient.registerFolder({
          id: r.id,
          parent_id: r.parent_id,
          color: null,
        });
      }
      for (const id of actions.unregister) {
        await registryClient.unregisterFolder({ id });
      }
      for (const m of actions.move) {
        await registryClient.moveFolder({ id: m.id, new_parent: m.new_parent_id });
      }

      const result: ReconcileResult = {
        registered: actions.register.length,
        unregistered: actions.unregister.length,
        moved: actions.move.length,
      };
      setState({ running: false, last: result, error: null });
      return result;
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setState({ running: false, last: null, error: err });
      return null;
    }
  }, [rootGroupId, registryClient, adminSubgroups]);

  return { ...state, run };
}
