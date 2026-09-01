# Mero Drive — Phase C-frontend (part 1): capability-bitmask realignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Replace mero-drive's home-grown `CAP` bitmask (`{READ:1, WRITE:2, CREATE_GROUP:4, MANAGE_GROUP:8, INVITE_MEMBERS:16, MANAGE_MEMBERS:32}`) with core's real `MemberCapabilities` bits (re-exported from `@calimero-network/mero-js`'s `CAPABILITIES`), so the `setMemberCapabilities`/`getMemberCapabilities`/`setDefaultCapabilities` u32 the app writes means to core what the app thinks it means. Today bit 2 (`WRITE`) collides with core's `CAN_JOIN_OPEN_SUBGROUPS` and bit 5 (`MANAGE_MEMBERS`) collides with core's `CAN_CREATE_SUBGROUP` — a "Viewer" (caps=1) is `CAN_CREATE_CONTEXT` to core, an "Editor" (caps=3) is `CAN_CREATE_CONTEXT|CAN_INVITE_MEMBERS`, etc.

**Scope of THIS plan (part 1 of Phase C-frontend):** the cap-vocabulary swap + re-derivation of the permission hooks + the role presets + downstream consumers + tests + the merobox `members.yml` CAP comments. **Out of scope (later parts):** `setDefaultCapabilities` on namespace create + `claim_owner` on registry-context create + `NamespaceSettingsPanel` "Member defaults" section (part 2); `useFolderRole` + `FolderSharingPanel`/`WorkspaceSettingsPanel` owner/managers/Role UI + doc-editor `canEditDocs` gating (part 3). Spec: `docs/superpowers/specs/2026-05-12-open-restricted-folders-permissions-design.md` §5.1 / §5.3.

**Tech stack:** React + TS + Vitest. mero-js `@^2.1.0` exports `CAPABILITIES` (`{ CAN_CREATE_CONTEXT:1, CAN_INVITE_MEMBERS:2, CAN_JOIN_OPEN_SUBGROUPS:4, MANAGE_MEMBERS:8, MANAGE_APPLICATION:16, CAN_CREATE_SUBGROUP:32, CAN_DELETE_SUBGROUP:64, CAN_MANAGE_VISIBILITY:128, CAN_MANAGE_METADATA:256 }`) + `hasCap`/`withCap`/`withoutCap`. Worktree: `/Users/beast/Developer/Calimero/mero-drive--open-restricted`, branch `feat/open-restricted-folders-frontend`. Run frontend cmds from repo root: `pnpm --dir app exec tsc --noEmit`, `pnpm --dir app test`, `pnpm --dir app lint`, `pnpm --dir app build`.

---

## The intent → core-bit mapping (use this everywhere)

| old `CAP.*` intent | new vocabulary |
|---|---|
| `READ` | **deleted** — folder *membership alone* implies read; "viewer vs editor on docs" is the registry `Role` (part 3), not a cap bit |
| `WRITE` | **deleted** — same; doc-edit ability is the registry `Role` |
| `CREATE_GROUP` (create a folder) | `CAPABILITIES.CAN_CREATE_SUBGROUP` (root-level only — core only allows subgroups directly under the namespace root) |
| `MANAGE_GROUP` (rename/recolor folder, manage folder) | split: rename/recolor → `CAPABILITIES.CAN_MANAGE_METADATA`; visibility toggle → `CAPABILITIES.CAN_MANAGE_VISIBILITY`; delete folder → `CAPABILITIES.CAN_DELETE_SUBGROUP` |
| `INVITE_MEMBERS` | `CAPABILITIES.CAN_INVITE_MEMBERS` |
| `MANAGE_MEMBERS` | `CAPABILITIES.MANAGE_MEMBERS` |
| (creating a folder's `docs` context) | `CAPABILITIES.CAN_CREATE_CONTEXT` |
| `MANAGE_APPLICATION` | never used by mero-drive |

`isAdmin` (core group-admin role) always bypasses the bitmask — keep that short-circuit in `useMemberCaps`.

---

## Task 1: re-point `constants/config.ts` at mero-js `CAPABILITIES`

**Files:** Modify `app/src/constants/config.ts`

- [ ] **Step 1:** Replace the `CAP` const + `DEFAULT_CHILD_CAP_MASK` block with a re-export of mero-js's `CAPABILITIES`:

```ts
// Member-capability bitmask bits — re-exported verbatim from
// @calimero-network/mero-js's CAPABILITIES (core's `MemberCapabilities`,
// crates/context/config). This is the ONLY capability vocabulary in the
// app; the per-(folder,member) "viewer vs editor on docs" concept is the
// registry `Role`, not a cap bit. See design spec §5.1.
export {
  CAPABILITIES,
  hasCap,
  withCap,
  withoutCap,
} from '@calimero-network/mero-js';
export type { CapabilityName, CapabilityBit } from '@calimero-network/mero-js';
```

  Delete `DEFAULT_CHILD_CAP_MASK` entirely (the inherit-mode cascade it fed is gone since core PR #2261 — Open subgroups inherit via core's parent-walk; the app no longer does an `addGroupMembers` cascade. Confirm with `grep -rn DEFAULT_CHILD_CAP_MASK app/src` → if anything still references it, that call site is also dead-code-around-the-cascade and should be cleaned in Task 5; if it's load-bearing, STOP and report).

  Keep `ENV_APPLICATION_ID`, `REGISTRY_SERVICE_ID`, `DOCS_SERVICE_ID`, `REGISTRY_CONTEXT_ALIAS`, `MAX_FOLDER_DEPTH`, `MAX_ALIAS_LENGTH` unchanged.

- [ ] **Step 2:** `grep -rn "from '\.\./constants/config'" app/src | grep -i cap` and `grep -rn "CAP\." app/src` to enumerate every consumer of the old `CAP` — they're all addressed in Tasks 2–5. Commit nothing yet (won't compile until the hooks are updated).

---

## Task 2: re-derive `useFolderPermissions` over the new bits

**Files:** Modify `app/src/hooks/useFolderPermissions.ts`, `app/src/hooks/__tests__/useFolderPermissions.test.ts`

- [ ] **Step 1:** New interface + derivation. Drop `canRead`/`canWrite` (membership ⇒ read; doc-edit is the registry `Role`, added in part 3 — leave a `// TODO(phase-c-part-3): canEditDocs from registry Role` comment, do NOT add `canEditDocs` here yet). Keep `loading`/`error`. New shape:

```ts
import { CAPABILITIES, hasCap } from '../constants/config';
import { useMemberCaps } from './useMemberCaps';

export interface FolderPermissions {
  /** Member of the folder subgroup at all (caps fetch succeeded). */
  isMember: boolean;
  /** Create a *sub*folder — note core only allows subgroups directly
   *  under the namespace root, so this is effectively a namespace-scope
   *  grant; kept here for the folder context menu's "new subfolder". */
  canCreateSubfolder: boolean;
  canRename: boolean;            // CAN_MANAGE_METADATA
  canManageVisibility: boolean;  // CAN_MANAGE_VISIBILITY
  canDelete: boolean;            // CAN_DELETE_SUBGROUP
  canInviteMembers: boolean;     // CAN_INVITE_MEMBERS
  canManageMembers: boolean;     // MANAGE_MEMBERS
  /** Aggregate: any folder-admin-ish power. Used to show the sharing
   *  panel / context-menu admin section. */
  canManageGroup: boolean;       // isAdmin || canManageMembers || canRename || canManageVisibility || canDelete || canInviteMembers
  loading: boolean;
  error: Error | null;
}

export function useFolderPermissions(namespaceId: string, folderId: string): FolderPermissions {
  const { caps, isAdmin, error } = useMemberCaps(namespaceId, folderId);
  const has = (bit: number) => isAdmin || (caps !== null && hasCap(caps, bit));
  const canRename = has(CAPABILITIES.CAN_MANAGE_METADATA);
  const canManageVisibility = has(CAPABILITIES.CAN_MANAGE_VISIBILITY);
  const canDelete = has(CAPABILITIES.CAN_DELETE_SUBGROUP);
  const canInviteMembers = has(CAPABILITIES.CAN_INVITE_MEMBERS);
  const canManageMembers = has(CAPABILITIES.MANAGE_MEMBERS);
  const canCreateSubfolder = has(CAPABILITIES.CAN_CREATE_SUBGROUP);
  return {
    isMember: caps !== null,
    canCreateSubfolder,
    canRename,
    canManageVisibility,
    canDelete,
    canInviteMembers,
    canManageMembers,
    canManageGroup: canRename || canManageVisibility || canDelete || canInviteMembers || canManageMembers,
    loading: caps === null,
    error,
  };
}
```

  NOTE: `useMemberCaps` currently returns `{ caps, error }` — it must also surface `isAdmin` (it already computes it internally for the all-caps short-circuit). In Task 4 we change `useMemberCaps` to return `{ caps, isAdmin, error }` (when `isAdmin`, `caps` is still set to the full mask — keep that; `isAdmin` is just exposed alongside). If touching `useMemberCaps` is risky, an interim acceptable shim: keep `caps` returning the all-bits mask for admins (so `has(...)` is true for everything) and derive `isAdmin` as "caps === every-known-bit" — but cleaner to expose it. Prefer exposing.

- [ ] **Step 2:** Rewrite `useFolderPermissions.test.ts` for the new bits/booleans. Cases: caps=`CAN_CREATE_SUBGROUP` → `canCreateSubfolder` true, others false; caps=`CAN_MANAGE_METADATA` → `canRename` true + `canManageGroup` true, `canDelete` false; caps=`MANAGE_MEMBERS|CAN_INVITE_MEMBERS` → both + `canManageGroup`; `isAdmin` → everything true; caps=`null` → `loading` true / `isMember` false; error path → `error` non-null. Keep/adapt the PR-#2261-inheritance case (a namespace member with `CAN_JOIN_OPEN_SUBGROUPS` who gets real folder caps from the admin API — assert on whatever folder caps that scenario yields).

---

## Task 3: re-derive `useNamespacePermissions` over the new bits

**Files:** Modify `app/src/hooks/useNamespacePermissions.ts`, `app/src/hooks/__tests__/useNamespacePermissions.test.ts`

- [ ] **Step 1:**

```ts
import { CAPABILITIES, hasCap } from '../constants/config';
import { useMemberCaps } from './useMemberCaps';

export interface NamespacePermissions {
  /** Create a top-level folder (core: CAN_CREATE_SUBGROUP, root-only). */
  canCreateFolder: boolean;
  /** Join Open folders (default-on for new members). */
  canJoinOpenFolders: boolean;
  canCreateContext: boolean;     // CAN_CREATE_CONTEXT — needed to create a folder's docs ctx
  canManageVisibility: boolean;  // CAN_MANAGE_VISIBILITY
  canManageMetadata: boolean;    // CAN_MANAGE_METADATA (rename folders / set display names)
  canInviteMembers: boolean;     // CAN_INVITE_MEMBERS
  canManageMembers: boolean;     // MANAGE_MEMBERS
  /** Aggregate admin-ish: show namespace settings / members panels. */
  canManageNamespace: boolean;   // isAdmin || canManageMembers || canManageMetadata || canManageVisibility || canInviteMembers
  loading: boolean;
  error: Error | null;
}

export function useNamespacePermissions(namespaceId: string, rootGroupId: string): NamespacePermissions {
  const { caps, isAdmin, error } = useMemberCaps(namespaceId, rootGroupId);
  const has = (bit: number) => isAdmin || (caps !== null && hasCap(caps, bit));
  const canManageMembers = has(CAPABILITIES.MANAGE_MEMBERS);
  const canManageMetadata = has(CAPABILITIES.CAN_MANAGE_METADATA);
  const canManageVisibility = has(CAPABILITIES.CAN_MANAGE_VISIBILITY);
  const canInviteMembers = has(CAPABILITIES.CAN_INVITE_MEMBERS);
  return {
    canCreateFolder: has(CAPABILITIES.CAN_CREATE_SUBGROUP),
    canJoinOpenFolders: has(CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS),
    canCreateContext: has(CAPABILITIES.CAN_CREATE_CONTEXT),
    canManageVisibility,
    canManageMetadata,
    canInviteMembers,
    canManageMembers,
    canManageNamespace: canManageMembers || canManageMetadata || canManageVisibility || canInviteMembers,
    loading: caps === null,
    error,
  };
}
```

  Renames vs old: `canCreateSubgroup` → `canCreateFolder`; `canManageNamespaceMembers` → `canManageMembers`. Update all consumers (Task 5).

- [ ] **Step 2:** Rewrite `useNamespacePermissions.test.ts` accordingly.

---

## Task 4: expose `isAdmin` from `useMemberCaps`

**Files:** Modify `app/src/hooks/useMemberCaps.ts` (and any `__tests__/useMemberCaps.test.ts` if present)

- [ ] **Step 1:** The hook currently returns `{ caps, error }` (with `caps` = `ALL_CAPS_BITMASK` (`0b111111`) when `role === 'Admin'`). Change: also return `isAdmin: boolean`. Replace the literal `ALL_CAPS_BITMASK = 0b111111` — for an admin we no longer need an all-bits mask (consumers gate on `isAdmin || hasCap(...)`); set `caps` for an admin to `0xffffffff` (`>>> 0`) or just keep returning a sentinel and rely on `isAdmin`. Cleanest: when admin, `setCaps(0xffffffff >>> 0)` and `setIsAdmin(true)`; non-admin: `setCaps(result.capabilities ?? 0)`, `setIsAdmin(false)`. Keep the 4-attempt retry/backoff exactly. Return `{ caps, isAdmin, error }` (and `loading` if it already returns one — keep its current shape, just add `isAdmin`).

- [ ] **Step 2:** If a `useMemberCaps.test.ts` exists, update it to assert `isAdmin` and the admin caps value.

---

## Task 5: update every consumer of the renamed booleans / `CAP`

**Files:** sweep `app/src` — likely: `app/src/components/folders/FolderContextMenu.tsx`, `NewFolderButton.tsx`, `FolderVisibilityToggle.tsx`, `FolderSharingPanel.tsx`, `RestrictedFolderCard.tsx` (only if it reads perms), `app/src/components/workspace/{WorkspaceSettingsPanel,NamespaceMembersPanel,NamespaceMemberRow,WorkspaceLayout,NamespaceSwitcher}.tsx`, `app/src/components/admin/*.tsx`, `app/src/hooks/{useFolderOperations,useDriveWorkspace,useWorkspaceTree}.ts`.

- [ ] **Step 1:** Mechanical renames:
  - `perms.canCreateSubgroup` → `perms.canCreateFolder` (namespace scope) / `perms.canCreateSubfolder` (folder scope) — pick per the perms object's type.
  - `perms.canManageNamespaceMembers` → `perms.canManageMembers`.
  - `perms.canManageGroup` (folder) — still exists (aggregate); for the *visibility* toggle gate use `perms.canManageVisibility` instead (FolderVisibilityToggle), for *rename* use `perms.canRename`, for *delete* use `perms.canDelete`. Tighten each gate to the specific bit; fall back to `canManageGroup` only where a generic "is folder admin" check is wanted.
  - `perms.canRead` / `perms.canWrite` — these are GONE. Any UI that gated on `canRead` (e.g. "can the user see this folder's docs at all") now uses `isMember` (folder membership ⇒ read). Any that gated doc-*editing* on `canWrite` → leave a `// TODO(phase-c-part-3): gate on useFolderRole` and for now keep the affordance enabled if `isMember` (we'll tighten in part 3). Note this in the PR description.
  - Anything importing `CAP` from `constants/config` → import `CAPABILITIES` (and `hasCap` if doing raw bit checks).
- [ ] **Step 2:** `MemberRoleSelect.tsx` — rewrite `ROLE_PRESETS` to the §5.3 **namespace-level** presets (this control is currently used for namespace member rows; folder-scope presets come in part 3):

```ts
import { CAPABILITIES, withCap } from '@/constants/config';

const C = CAPABILITIES;
const EDITOR_MASK = C.CAN_JOIN_OPEN_SUBGROUPS | C.CAN_CREATE_SUBGROUP | C.CAN_CREATE_CONTEXT; // 4|32|1 = 37
export const ROLE_PRESETS: { label: string; mask: number }[] = [
  { label: 'Viewer', mask: C.CAN_JOIN_OPEN_SUBGROUPS },
  { label: 'Editor', mask: EDITOR_MASK },
  {
    label: 'Manager',
    mask:
      EDITOR_MASK |
      C.CAN_INVITE_MEMBERS |
      C.MANAGE_MEMBERS |
      C.CAN_MANAGE_VISIBILITY |
      C.CAN_DELETE_SUBGROUP |
      C.CAN_MANAGE_METADATA,
  },
];
```

  Update the file-header comment (presets are now Viewer/Editor/Manager; "Admin" = core group-admin role, handled by the caller not this dropdown; "Custom" = any other mask, read-only label). The `value`/`onChange` mechanics stay. Keep the "Custom" branch.

- [ ] **Step 3:** `pnpm --dir app exec tsc --noEmit` → fix every type error this cascade produced until it's 0. `pnpm --dir app lint` → 0.

- [ ] **Step 4:** `app/src/components/__tests__/permission-gating.test.tsx` — update the `noFolderPerms`/`noNsPerms` mocks to the new interface shapes (drop `canRead`/`canWrite`/`canCreateSubgroup`/`canManageNamespaceMembers`, add `isMember`/`canCreateFolder`/`canManageMembers`/`canManageVisibility`/`canRename`/`canDelete`/`canManageMetadata`/etc.), and adjust the gate assertions (e.g. `FolderVisibilityToggle` now gates on `canManageVisibility`, `NewFolderButton` on `canCreateFolder`). Keep the test intent (each gate hidden without its cap, shown with it). Also update `useWorkspaceTree.test.ts` only if it referenced `CAP`/the old booleans (it probably doesn't).

- [ ] **Step 5:** `pnpm --dir app test` → all green. `pnpm --dir app build` → ok.

---

## Task 6: fix the merobox `members.yml` capability comments

**Files:** Modify `e2e/workflow-mero-drive-members.yml`

- [ ] **Step 1:** The workflow's comments + the bitmask *values* it asserts (`Viewer=1`, `Editor=3`, `Admin=63`, "non-preset WRITE=2", `set_default_capabilities 3`) describe the OLD `CAP` layout, which never matched what core actually does with those bits — the values "worked" only because the workflow just round-trips whatever it writes. Realign to the new vocabulary so the workflow documents reality:
  - `Viewer` → `4` (`CAN_JOIN_OPEN_SUBGROUPS`)
  - `Editor` → `37` (`CAN_JOIN_OPEN_SUBGROUPS|CAN_CREATE_SUBGROUP|CAN_CREATE_CONTEXT`)
  - `Manager` → `37 | 2 | 8 | 128 | 64 | 256 = 495` (`+CAN_INVITE_MEMBERS|MANAGE_MEMBERS|CAN_MANAGE_VISIBILITY|CAN_DELETE_SUBGROUP|CAN_MANAGE_METADATA`)
  - the "non-preset" custom mask: pick something clearly non-preset, e.g. `CAN_MANAGE_METADATA` alone = `256`
  - `set_default_capabilities` step → `37` (the Editor preset)
  - Rewrite the `# CAP bit layout (from constants/config.ts)` comment block to the core bits, and update each step name's parenthetical (`Viewer preset (CAN_JOIN_OPEN_SUBGROUPS = 4)` etc.) and the `assert` literals to match. The `get_member_capabilities` → `assert {{x}} == <n>` round-trips still hold (it's store-verbatim).
  - Bump `e2e/workflow-mero-drive-members.yml`'s bundle path is already `…9.1.0.mpk` from the prior PR — leave it.

- [ ] **Step 2:** `python3 -c "import yaml; yaml.safe_load(open('e2e/workflow-mero-drive-members.yml'))"` → parses.

---

## Task 7: commit, push, PR

- [ ] **Step 1:** `git add` the changed files; commit in 2–3 logical chunks (e.g. `feat(app): realign capability bitmask with core's MemberCapabilities bits` for config+hooks+presets+consumers; `test(app): update permission tests for the realigned capability bits`; `test(e2e): realign members.yml capability comments/values with core bits`). Co-Authored-By trailer on each.
- [ ] **Step 2:** `git push origin feat/open-restricted-folders-frontend`; `gh pr create --base refactor/frontend-battleships-alignment --title "feat(app): realign capability bitmask with core's MemberCapabilities" --body "..."` — body explains the collision bug, the intent→bit mapping, what's deferred to parts 2/3 (default caps + claim_owner + NamespaceSettingsPanel member-defaults; useFolderRole + folder-scope role presets + WorkspaceSettingsPanel owner/managers + doc-editor canEditDocs gating), and notes the temporarily-loosened doc-edit gate (`isMember` until part 3).
- [ ] **Step 3:** Report: commits, `tsc`/`lint`/`test`/`build` results, the consumer files touched, anything that turned out load-bearing/surprising (esp. `DEFAULT_CHILD_CAP_MASK` and any `canRead`/`canWrite` consumer that genuinely needs doc-role gating now), and the open §5.3 "namespace-Manager keeps MANAGE_MEMBERS" decision (the plan assumes keep).

## Self-review
- Spec §5.1 booleans all present? `canJoinOpenFolders`/`canCreateFolder`(`canCreateSubfolder`)/`canInviteMembers`/`canManageMembers`/`canManageVisibility`/`canRename` ✓ (`canEditDocs`/`canDelete`-from-Role explicitly deferred to part 3 — `canDelete` here is the *core cap* `CAN_DELETE_SUBGROUP`, which the actual delete call needs anyway).
- No `READ`/`WRITE`/`APP_CAN_EDIT_DOCS` bit anywhere. ✓
- `isAdmin` short-circuit preserved in every `has(...)`. ✓
- Presets match §5.3 namespace table (Viewer=`CAN_JOIN_OPEN_SUBGROUPS`; Editor=`+CAN_CREATE_SUBGROUP|CAN_CREATE_CONTEXT`; Manager=`+CAN_INVITE_MEMBERS|MANAGE_MEMBERS|CAN_MANAGE_VISIBILITY|CAN_DELETE_SUBGROUP|CAN_MANAGE_METADATA`). ✓
- No placeholders; every code step has the code.
