# Mero Drive — Phase C-frontend (parts 2 & 3): default caps + claim_owner + folder-Role UI Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`. Continues `2026-05-13-mero-drive-phase-c-frontend-cap-realignment.md` (part 1, PR #38, merged into this same branch `feat/open-restricted-folders-frontend`).

**Goal:** Finish the frontend permissions wiring per spec §5.2 / §5.3 / §5.5: (part 2) set the namespace's default new-member capabilities + `claim_owner` the registry context on creation + a "Member defaults" admin section; (part 3) the per-(folder,member) registry `Role` — a `useFolderRole` hook, `canEditDocs`/`canManagePermissions`/`canDelete`-from-Role in `useFolderPermissions`, the doc-editor edit gate (replacing the part-1 `isMember` placeholder), a folder-scope role-preset dropdown in `FolderSharingPanel`, and an owner/managers section + reconcile in `WorkspaceSettingsPanel`.

**Tech stack:** React + TS + Vitest. `RegistryClient` already has `claimOwner()`/`getOwner()`/`addManager()`/`removeManager()`/`listManagers()`/`setFolderRole(folder_id,member,role)`/`clearFolderRole(folder_id,member)`/`getFolderRole(folder_id,member)`/`listFolderRoles(folder_id)` and `Role = 'Viewer' | 'Editor' | 'Manager'`, `FolderRoleEntry = { member: string; role: Role }`. mero-react exports `useDefaultCapabilities(groupId)` → `{ defaultCapabilities: number|null, ... }`, `useSetDefaultCapabilities`, `useGroupInfo`, `useSubgroupVisibility`, `useGroupCapabilities(groupId, identity)` → `{ capabilities, loading, error, setCapabilities }`, `useAddGroupMembers`/`useRemoveGroupMembers`. `useDriveWorkspace()` exposes `namespaceId`, `rootGroupId`, `registryContextId`, `selfIdentity`, `registryClient` (a `RegistryClient | null`), `folders`, `createWorkspace`. `mero.admin.createContext({applicationId, groupId, serviceName, initializationParams})` returns `{ contextId, memberPublicKey }` (verify exact field names from the generated admin types). Run frontend cmds from repo root: `pnpm --dir app exec tsc --noEmit`, `pnpm --dir app test`, `pnpm --dir app lint`, `pnpm --dir app build`. Worktree `/Users/beast/Developer/Calimero/mero-drive--open-restricted`, branch `feat/open-restricted-folders-frontend`. Do NOT `pnpm install`.

**Constants:** `EDITOR_CAPS = CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS | CAPABILITIES.CAN_CREATE_SUBGROUP | CAPABILITIES.CAN_CREATE_CONTEXT` (= 37) — the namespace default + the `MemberRoleSelect` "Editor" preset (already defined in `MemberRoleSelect.tsx` as `EDITOR_MASK`; export it or re-derive). Folder-scope `Role` presets per spec §5.3: Viewer→`Role.Viewer` + no folder caps; Editor→`Role.Editor` + no folder caps; Manager→`Role.Manager` + `CAN_INVITE_MEMBERS|MANAGE_MEMBERS|CAN_MANAGE_VISIBILITY|CAN_DELETE_SUBGROUP|CAN_MANAGE_METADATA`.

---

## Part 2 — default caps + claim_owner + Member-defaults UI

### Task 1: `setDefaultCapabilities` + `claim_owner` on namespace/registry-context creation

**Files:** `app/src/hooks/useDriveWorkspace.ts`

- [ ] **Step 1:** In `createWorkspace` (the `useCallback` ~line 422): after `createNamespace` returns `ns.namespaceId` and BEFORE/AFTER `createContext` (order: namespace → setDefaultCapabilities → createContext → claimOwner), add:

```ts
// New members inherit the "Editor" set: join + create open folders + create docs contexts.
await mero.admin.setDefaultCapabilities(ns.namespaceId, EDITOR_CAPS); // EDITOR_CAPS = 37
```

  then after `await mero.admin.createContext({... serviceName: REGISTRY_SERVICE_ID ...})` (capture its result):

```ts
const reg = await mero.admin.createContext({ applicationId, groupId: ns.namespaceId, serviceName: REGISTRY_SERVICE_ID, initializationParams: [] });
// Claim the registry's owner slot for the creator — the permissions layer is
// fail-closed until this runs (set_folder_role etc. require owner/manager).
if (reg?.contextId && reg?.memberPublicKey) {
  await new RegistryClient(mero, reg.contextId, reg.memberPublicKey).claimOwner();
}
```

  (Import `RegistryClient` from `../api/registry/RegistryClient`, and `CAPABILITIES` from `../constants/config`; define `const EDITOR_CAPS = CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS | CAPABILITIES.CAN_CREATE_SUBGROUP | CAPABILITIES.CAN_CREATE_CONTEXT;` near the top of the file, or import `EDITOR_MASK` from `MemberRoleSelect` — prefer a small shared const; if you add one, put it in `constants/config.ts` as `export const DEFAULT_NEW_MEMBER_CAPS = ...` and use it in both `useDriveWorkspace` and `MemberRoleSelect`.) Wrap the `setDefaultCapabilities`/`claimOwner` calls so a failure there doesn't abort namespace creation outright — but DO surface it: `catch` around just those two, log via the existing error pattern, and still return `ns.namespaceId` (the workspace is usable; an admin can re-run claim via the settings panel — see Task 3). Actually simpler: let them throw (they're part of a correct setup); only loosen if a real failure mode shows up. **Decision: let them throw** — keep `createWorkspace`'s single try/catch.

  Verify `createContext`'s return shape against `app/src/api`/the mero-react admin types — it may be `{ contextId, memberPublicKey }` or `{ contextId, executorPublicKey }` or nested under `.data`. Use whatever the existing `createContext` call sites / generated types say.

- [ ] **Step 2:** The self-heal `useEffect` (~line 213–258) that recreates the Registry context if `contextId[0]` is missing — after its `createContext`, also `claimOwner()` (same pattern; idempotent — `claim_owner` is a no-op for the existing owner, errors only if a *different* key already owns it, which won't happen here). Wrap in a `.catch(() => {})` since this is a best-effort heal.

- [ ] **Step 3:** `pnpm --dir app exec tsc --noEmit` → 0. `pnpm --dir app test` → green (no test changes expected; if a `useDriveWorkspace` test mocks `mero.admin`, add stubs for `setDefaultCapabilities`/the `createContext` return + a `RegistryClient` mock — minimal).

- [ ] **Step 4:** Commit: `feat(app): set default member caps + claim registry ownership on workspace create`.

### Task 2: `useDefaultCapabilities` consumption + "Member defaults" section in `NamespaceSettingsPanel`

**Files:** `app/src/components/workspace/NamespaceSettingsPanel.tsx` (or a new `app/src/components/admin/MemberDefaultsPanel.tsx` it composes — prefer a new small component), maybe `app/src/components/__tests__/permission-gating.test.tsx`

- [ ] **Step 1:** New component `MemberDefaultsPanel`:
  - Reads current default caps: `const { defaultCapabilities } = useDefaultCapabilities(namespaceId);` (from mero-react).
  - Gated: only render if `useNamespacePermissions(namespaceId, rootGroupId).canManageNamespace` (else `return null`). Get `namespaceId`/`rootGroupId` from `useDriveWorkspace()`.
  - Renders a labelled checklist of the namespace-relevant core caps — `CAN_JOIN_OPEN_SUBGROUPS` ("Join open folders"), `CAN_CREATE_SUBGROUP` ("Create folders"), `CAN_CREATE_CONTEXT` ("Create documents"), `CAN_INVITE_MEMBERS` ("Invite members"), `MANAGE_MEMBERS` ("Manage members"), `CAN_MANAGE_VISIBILITY` ("Change folder visibility"), `CAN_MANAGE_METADATA` ("Rename folders"), `CAN_DELETE_SUBGROUP` ("Delete folders") — each checkbox `checked={hasCap(current, bit)}`, toggling updates a local `draft` mask via `withCap`/`withoutCap`.
  - Pre-fill `draft` from `defaultCapabilities ?? EDITOR_CAPS` once it loads.
  - "Save defaults" button → `const { mutate: setDefaults } = useSetDefaultCapabilities()` (or whatever the hook's API is — check `useSetDefaultCapabilities`'s signature; might be `setDefaultCapabilities(groupId, caps)` direct) → on click `await setDefaults(namespaceId, draft)` then refetch. Disabled while loading or `draft === current`.
  - A "Reset to Editor preset" link sets `draft = EDITOR_CAPS`.
  - Helper copy: "New members joining this workspace via invite get these capabilities. Existing members are unaffected."
- [ ] **Step 2:** Render `<MemberDefaultsPanel />` inside `NamespaceSettingsPanel` between the header and `<NamespaceMembersPanel />`.
- [ ] **Step 3:** Add a gate test in `permission-gating.test.tsx`: `MemberDefaultsPanel` renders nothing when `canManageNamespace` is false, renders the checklist when true (mock `useNamespacePermissions` + `useDefaultCapabilities`).
- [ ] **Step 4:** `tsc`/`lint`/`test` green. Commit: `feat(app): namespace member-defaults panel (set default new-member capabilities)`.

---

## Part 3 — per-folder registry `Role`

### Task 3: `useFolderRole` hook + `useRegistryOwner` hook

**Files:** new `app/src/hooks/useFolderRole.ts`, new `app/src/hooks/useRegistryAdmin.ts` (owner + managers), maybe `app/src/hooks/__tests__/useFolderRole.test.ts`

- [ ] **Step 1:** `useFolderRole(folderId: string | null)`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { useDriveWorkspace } from './useDriveWorkspace';
import type { Role } from '../api/registry/RegistryClient';

export interface FolderRoleState {
  role: Role | null;        // null = loading / unknown; treat absent-on-server as 'Editor'
  loading: boolean;
  error: Error | null;
  /** Set the caller-supplied member's role (default = the current identity). */
  setRole: (role: Role, member?: string) => Promise<void>;
  clearRole: (member?: string) => Promise<void>;
  refetch: () => void;
}

export function useFolderRole(folderId: string | null): FolderRoleState {
  const { registryClient, selfIdentity } = useDriveWorkspace();
  const [role, setRoleState] = useState<Role | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!registryClient || !folderId || !selfIdentity) { setRoleState(null); return; }
    setRoleState(null); setError(null);
    registryClient.getFolderRole(folderId, selfIdentity)
      .then((r) => { if (!cancelled) setRoleState((r as Role) ?? 'Editor'); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e : new Error(String(e))); });
    return () => { cancelled = true; };
  }, [registryClient, folderId, selfIdentity, tick]);
  const setRole = useCallback(async (r: Role, member?: string) => {
    if (!registryClient || !folderId) return;
    await registryClient.setFolderRole(folderId, member ?? selfIdentity!, r);
    setTick((t) => t + 1);
  }, [registryClient, folderId, selfIdentity]);
  const clearRole = useCallback(async (member?: string) => {
    if (!registryClient || !folderId) return;
    await registryClient.clearFolderRole(folderId, member ?? selfIdentity!);
    setTick((t) => t + 1);
  }, [registryClient, folderId, selfIdentity]);
  return { role, loading: role === null && error === null, error, setRole, clearRole, refetch: () => setTick((t) => t + 1) };
}
```

  Also a `useFolderRoles(folderId)` → `{ entries: FolderRoleEntry[], loading, error, refetch }` reading `listFolderRoles` (for the `FolderSharingPanel` member list — Task 5).

- [ ] **Step 2:** `useRegistryAdmin()` → `{ owner: string | null; managers: string[]; isOwnerOrManager: boolean; loading; error; addManager(member); removeManager(member); refetch }` — reads `registryClient.getOwner()` (now returns `string`; treat `""` as "unclaimed → null") + `listManagers()`; `isOwnerOrManager = owner === selfIdentity || managers.includes(selfIdentity)`. `addManager`/`removeManager` call the client + refetch.

- [ ] **Step 3:** Tests for `useFolderRole` (mock a fake `registryClient` via a `useDriveWorkspace` mock): returns `'Editor'` when the client resolves `'Editor'` / when it resolves `undefined`/`null`; `setRole` calls the client method and refetches; error path sets `error`. Keep minimal.

- [ ] **Step 4:** `tsc`/`test` green. Commit: `feat(app): useFolderRole / useRegistryAdmin hooks (registry permissions read+write)`.

### Task 4: wire `canEditDocs` / `canManagePermissions` / `canDelete` into `useFolderPermissions` and the doc editor

**Files:** `app/src/hooks/useFolderPermissions.ts`, `app/src/components/folders/DocumentEditor.tsx`, `app/src/components/folders/DocumentList.tsx`, `app/src/hooks/__tests__/useFolderPermissions.test.ts`

- [ ] **Step 1:** `useFolderPermissions` — pull in `useFolderRole(folderId)` and `useRegistryAdmin()`. Add to the returned object:
  - `canEditDocs: isAdmin || isMember && role !== 'Viewer'` — where `isAdmin` comes from `useMemberCaps`, `isMember` is the existing flag, `role` from `useFolderRole` (treat `role === null` while loading as **optimistic true if isMember** — the editor shows then disables on a definitive `'Viewer'`; OR pessimistic false until loaded — pick optimistic-true-while-loading to avoid a flash of read-only, and add a `roleLoading` flag so the editor can show a subtle "checking permissions" hint if it wants).
  - `canManagePermissions: isAdmin || useRegistryAdmin().isOwnerOrManager` — gates the folder-scope role dropdowns / the sharing-panel admin section.
  - Refine `canDelete`: keep it as `has(CAN_DELETE_SUBGROUP)` for the *core delete call* but the UI affordance for "delete folder" should be `canDelete && (isAdmin || role === 'Manager' || isOwnerOrManager)` — actually simplest per spec §5.5: `canDelete = isAdmin || (has(CAN_DELETE_SUBGROUP) && role === 'Manager')`. Keep `canRename = isAdmin || has(CAN_MANAGE_METADATA)` as-is.
  - Add `role: Role | null` and `roleLoading: boolean` to the returned interface so consumers can show the badge.
  - Remember the existing TODO comment in `useFolderPermissions.ts` — replace `// TODO(phase-c-part-3): canEditDocs from registry Role` with the real impl.
- [ ] **Step 2:** `DocumentEditor.tsx` / `DocumentList.tsx` — they currently have a local `const canEditDocs = perms.isMember;` + a `TODO(phase-c-part-3)`. Replace with `const canEditDocs = perms.canEditDocs;` and drop the TODO. The `readOnly` / disabled-button / "New" affordances now reflect the registry `Role`.
- [ ] **Step 3:** `useFolderPermissions.test.ts` — add cases: `role === 'Viewer'` (member) → `canEditDocs` false; `role === 'Editor'`/`'Manager'` → `canEditDocs` true; `isAdmin` → `canEditDocs` true regardless of role; `isOwnerOrManager` (mock `useRegistryAdmin`) → `canManagePermissions` true; `role === 'Manager'` + `CAN_DELETE_SUBGROUP` → `canDelete` true, `role === 'Editor'` + `CAN_DELETE_SUBGROUP` → `canDelete` false. (Mock `useFolderRole` + `useRegistryAdmin`.)
- [ ] **Step 4:** `tsc`/`lint`/`test`/`build` green. Commit: `feat(app): gate doc editing on the registry Role (canEditDocs / canManagePermissions)`.

### Task 5: folder-scope role-preset dropdown in `FolderSharingPanel`

**Files:** `app/src/components/folders/FolderSharingPanel.tsx`, new `app/src/components/admin/FolderRoleSelect.tsx`, maybe a small test in `permission-gating.test.tsx`

- [ ] **Step 1:** `FolderRoleSelect` — a dropdown over the **folder-scope** presets:

```ts
import { CAPABILITIES } from '@/constants/config';
import type { Role } from '@/api/registry/RegistryClient';
const C = CAPABILITIES;
export const FOLDER_ROLE_PRESETS: { label: string; role: Role; folderCaps: number }[] = [
  { label: 'Viewer',  role: 'Viewer',  folderCaps: 0 },
  { label: 'Editor',  role: 'Editor',  folderCaps: 0 },
  { label: 'Manager', role: 'Manager', folderCaps: C.CAN_INVITE_MEMBERS | C.MANAGE_MEMBERS | C.CAN_MANAGE_VISIBILITY | C.CAN_DELETE_SUBGROUP | C.CAN_MANAGE_METADATA },
];
```

  Props: `{ role: Role | null; folderCaps: number | null; onChange: (preset) => void; disabled?; ariaLabel? }`. Like `MemberRoleSelect`, it shows "Custom" (read-only label) when the (role, folderCaps) pair doesn't match a preset. Selecting a preset calls `onChange(preset)`.

- [ ] **Step 2:** `FolderSharingPanel` — per the spec §5.5:
  - For **Restricted** folders: keep the existing add-by-identity + invite + remove UI. For each member row, add a `<FolderRoleSelect>` bound to that member's `(useFolderRole-via-listFolderRoles role, useGroupCapabilities(folderId, member) caps)`; `onChange` does **both** `registryClient.setFolderRole(folderId, member, preset.role)` **and** `setCapabilities(preset.folderCaps)` (the `useGroupCapabilities` setter). Gated on `perms.canManagePermissions`.
  - For **Open** folders: replace the add/invite section with "Open to all workspace members — anyone in the workspace can join and edit." copy; STILL show the member list (the inherited members from `listGroupMembers`) each with the `<FolderRoleSelect>` so an admin can pin someone to `Viewer` (downgrade) or `Manager`. Gated on `perms.canManagePermissions`.
  - The member list needs each member's role: fetch `registryClient.listFolderRoles(folderId)` once (via `useFolderRoles(folderId)` from Task 3) and join on identity; members absent from that list show `Editor`.
  - "Advanced" expander per row (optional polish — can be a follow-up): individual core-cap checkboxes + the `Role` radio. If time-boxed, ship just the preset dropdown and leave a `// TODO: Advanced per-bit expander` comment.

- [ ] **Step 3:** Test (light): `FolderRoleSelect` shows the right options; `FolderSharingPanel`'s role dropdowns are hidden when `canManagePermissions` is false (mock perms). Don't over-test the radix dropdown internals.

- [ ] **Step 4:** `tsc`/`lint`/`test`/`build` green. Commit: `feat(app): per-folder role dropdown in FolderSharingPanel (registry Role + folder caps)`.

### Task 6: owner/managers section + reconcile in `WorkspaceSettingsPanel`

**Files:** `app/src/components/admin/WorkspaceSettingsPanel.tsx`, maybe `app/src/hooks/useReconcile.ts`

- [ ] **Step 1:** In `WorkspaceSettingsPanel` (already gated on `canManageNamespace`), add a "Registry owner & managers" section using `useRegistryAdmin()`:
  - Show the owner identity (truncated, with the same copy affordance the app uses elsewhere); show the managers list with a remove (×) button each; an add-by-identity input + "Add manager" button → `addManager(identity)`; all gated on the caller being the owner (`owner === selfIdentity`) — managers can't add/remove managers (owner-only, mirroring the WASM). Non-owner admins see the list read-only with a "only the workspace owner can change managers" note.
  - If `owner` is `null`/`""` (unclaimed — e.g. an older namespace created before this code), show a "Claim ownership" button → `registryClient.claimOwner()` then refetch. Gated on `canManageNamespace`.
- [ ] **Step 2:** The existing "Reconcile registry" action (in `useReconcile` / this panel) — extend its summary to also report registry-permission drift: list any `folder_roles` rows for folders that no longer exist in the merged tree (call `listFolderRoles` per folder is heavy — instead, since `unregister_folder` already tombstones roles on the WASM side, "drift" here is really just "owner/managers vs core namespace-admins out of sync"; report that delta and offer an "Add core admins as managers" button). If this is getting too deep, ship just the owner/managers section (Step 1) and leave the reconcile-extension as a `// TODO` — note it in the PR.
- [ ] **Step 3:** `tsc`/`lint`/`test`/`build` green. Commit: `feat(app): registry owner/managers admin section in WorkspaceSettingsPanel`.

---

## Task 7: push + PR update

- [ ] **Step 1:** `git push origin feat/open-restricted-folders-frontend`.
- [ ] **Step 2:** Update PR #38's body (`gh pr edit 38 --body ...` or `--body-file`) to cover the whole Phase C-frontend (parts 1+2+3): the cap realignment + default caps + claim_owner + the Member-defaults panel + `useFolderRole`/`useRegistryAdmin` + `canEditDocs`/`canManagePermissions` doc-edit gating + the `FolderSharingPanel` role dropdown + the `WorkspaceSettingsPanel` owner/managers section. Note the §5.3 namespace-Manager-keeps-MANAGE_MEMBERS assumption, and any "Advanced expander" / "reconcile-permission-drift" bits left as TODOs.
- [ ] **Step 3:** Report: commits, `tsc`/`lint`/`test`/`build` results, files created/touched, what (if anything) was left as a TODO and why, the exact shape of `createContext`'s return that you relied on, and anything load-bearing/surprising. If a gate fails and you can't fix it, STOP, leave work committed to the last green task, report where you're stuck — don't push broken state.

## Self-review
- §5.2: `setDefaultCapabilities(ns, 37)` on create ✓; new members default doc role = `Editor` (absent role row ⇒ Editor in `useFolderRole`) ✓.
- §5.4 frontend: `claim_owner` on registry-ctx create ✓ (the WASM is fail-closed without it).
- §5.5: `useFolderRole` ✓; `canEditDocs = isAdmin || (isMember && role !== 'Viewer')` ✓; `canManagePermissions = isAdmin || isOwnerOrManager` ✓; `canDelete` involves `role === 'Manager'` ✓; doc-editor gates on `canEditDocs` ✓; `NamespaceSettingsPanel` Member-defaults ✓; `FolderSharingPanel` folder-scope role dropdown writing both `setFolderRole` + folder caps ✓; `WorkspaceSettingsPanel` owner/managers ✓.
- No new core caps; no `APP_CAN_EDIT_DOCS` bit. ✓
- Part-1's `// TODO(phase-c-part-3)` markers in `useFolderPermissions.ts` / `DocumentEditor.tsx` / `DocumentList.tsx` / `EditorShell.tsx` all resolved. ✓
