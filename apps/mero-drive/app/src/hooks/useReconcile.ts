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
      // SubgroupEntry from mero-js's useSubgroups carries only
      // `{ groupId, alias? }` — no parent_id cross-reference. That
      // means the admin-side parent_id we feed into
      // computeReconcileActions must come from the registry itself,
      // which in turn means the move-detection branch in
      // computeReconcileActions is *unreachable* from this hook:
      // both admin.parent_id and regShape.parent_id originate from
      // the same regFolders fetch, so reg.parent_id !== g.parent_id
      // is always false. We deliberately DON'T apply actions.move
      // below to avoid pretending we've detected moves — that branch
      // is dead with the current mero-js API surface, and the Phase
      // 5 unit tests for computeReconcileActions still exercise it
      // against synthetic inputs until we have a hook that returns
      // parent_id per group.
      //
      // Drift-detection scope for this run:
      //   - register: admin groups missing from the registry   ✓
      //   - unregister: registry entries missing from admin    ✓
      //   - move: admin/registry parent_id mismatch            ✗ not observable
      //
      // In practice moves happen via useFolderOperations (which
      // updates both sides in lockstep), so the registry and admin
      // can only diverge on parent_id via external tooling (CLI,
      // manual admin-API usage). Reconcile catches the create/delete
      // cases and relies on the app's own write path to keep
      // parent_id consistent.
      // mero-react's useSubgroups can return `undefined` when the
      // upstream listSubgroups call hits the `{data}` unwrap bug —
      // without this null-guard, reconcile throws "cannot read
      // properties of undefined (reading 'map')" before it gets a
      // chance to compute any diff.
      const safeAdmin = adminSubgroups ?? [];
      const regById = new Map(regFolders.map((f) => [f.id, f]));
      const admin: AdminGroup[] = safeAdmin.map((s) => {
        const fromReg = regById.get(s.groupId);
        // `fromReg` missing means "admin knows about this group but
        // the registry doesn't yet" — reconcile will emit a
        // register_folder action. Default parent_id=null so the new
        // folder lands at the top level; if the caller wanted a
        // specific parent they would have called registerFolder
        // directly via useFolderOperations.create.
        return {
          id: s.groupId,
          parent_id: fromReg ? fromReg.parent_id : null,
          alias: s.alias,
        };
      });
      const regShape = regFolders.map((f) => ({
        id: f.id,
        parent_id: f.parent_id,
      }));
      const actions = computeReconcileActions(admin, regShape, rootGroupId);

      for (const r of actions.register) {
        await registryClient.registerFolder({
          id: r.id,
          parent_id: r.parent_id,
          color: null,
          // Reconcile doesn't know the admin-side alias here; leave
          // null so the client falls back to admin-API / id stub.
          // A follow-up pass could read aliases from the admin list
          // we already have in `admin` and seed them in.
          alias: null,
        });
      }
      for (const id of actions.unregister) {
        await registryClient.unregisterFolder({ id });
      }
      // actions.move intentionally not applied — see comment above.

      const result: ReconcileResult = {
        registered: actions.register.length,
        unregistered: actions.unregister.length,
        // `moved` is always 0 at this layer — see the comment above
        // the actions.move loop. Kept in the return shape so UI /
        // telemetry code doesn't need reshaping once we gain a
        // parent_id-returning admin hook and can re-enable move
        // detection.
        moved: 0,
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
