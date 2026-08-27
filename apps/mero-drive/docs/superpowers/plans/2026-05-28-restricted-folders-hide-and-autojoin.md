# Restricted Folders: Hide-from-Non-Members + Add-Members-at-Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Hide restricted folders entirely from members who aren't in them (no "ask admin" card), and (B) let the folder creator pick namespace members at creation so they're added immediately and their docs sync when they open the folder — no manual "Join".

**Architecture:** Two independent app-layer changes in `app/`, no Rust/core/mpk changes.
- **A (hide):** The folder rail is built in `useDriveWorkspace` from the **registry** (`getFolders()`), which returns every folder to everyone. We already fan out one `getGroupInfo(id)` per folder; core *rejects* that call for non-members of a restricted subgroup (`isAccessDeniedError` → "not a member"). We capture which folders came back access-denied and filter them out of the merged list in `mergeAdminAndRegistry`. Re-resolves automatically on the existing SSE-driven refetch, so a folder un-hides the moment the caller is added.
- **B (add at creation):** Extend the create flow to `addGroupMembers` for chosen identities (best-effort, after the folder is fully created), and add a member-picker to `NewFolderDialog` shown only for Restricted folders. The recipient side needs **no new code**: `useMemberCaps` already live-refreshes on SSE events (flipping the added member to `isMember`), and `useDocs` already self-heals the docs-context join on first read.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest + @testing-library/react, `@calimero-network/mero-react` / `mero-js` 2.2.1 SDK.

**Prerequisite (already done):** `@calimero-network/mero-js` bumped to `^2.2.1` (fixes `listSubgroups`). Not required by this plan's logic but should be committed alongside.

**Test command (from repo root):** `pnpm --dir app exec vitest run <path>`
**Typecheck (from `app/`):** `pnpm exec tsc --noEmit -p tsconfig.json`

---

## File Structure

**Part A — hide restricted folders:**
- Modify `app/src/hooks/useWorkspaceTree.ts` — add a `hiddenIds` param to the pure `mergeAdminAndRegistry` and filter those folders out. (Pure, fully unit-tested.)
- Modify `app/src/hooks/__tests__/useWorkspaceTree.test.ts` — cover the new filter.
- Modify `app/src/hooks/useDriveWorkspace.ts` — in the existing per-folder `getGroupInfo` fan-out, classify `isAccessDeniedError` responses into a `hiddenFolderIds` set and pass it into `mergeAdminAndRegistry`. (Wiring; verified by typecheck + manual e2e.)

**Part B — add members at creation:**
- Modify `app/src/hooks/useFolderOperations.ts` — add `members?: string[]` to `CreateFolderInput`; `addGroupMembers` (best-effort) as the last create step.
- Create `app/src/hooks/__tests__/useFolderOperations.test.ts` — covers member-add ordering + best-effort failure.
- Modify `app/src/components/folders/NewFolderDialog.tsx` — member-picker (Restricted only) using the existing `MemberPicker`, with selected-member chips.
- Create `app/src/components/folders/__tests__/NewFolderDialog.test.tsx` — covers picker visibility-gating + members passed to `create`.

**Recipient side (B):** no code — `useMemberCaps` (SSE refresh) + `useDocs` (join self-heal) already handle it. Task B4 is a manual e2e verification checklist.

---

## Part A — Hide restricted folders from non-members

### Task A1: `mergeAdminAndRegistry` drops hidden folders

**Files:**
- Modify: `app/src/hooks/useWorkspaceTree.ts:59-86`
- Test: `app/src/hooks/__tests__/useWorkspaceTree.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `app/src/hooks/__tests__/useWorkspaceTree.test.ts` (inside the existing `describe('mergeAdminAndRegistry', …)` block; if none, add a new one and import `mergeAdminAndRegistry`):

```ts
import { mergeAdminAndRegistry } from '../useWorkspaceTree';

describe('mergeAdminAndRegistry hiddenIds', () => {
  const root = 'root-group';
  const reg = [
    { id: 'f-open', parent_id: null, color: null },
    { id: 'f-secret', parent_id: null, color: null },
  ];

  it('excludes folders whose id is in hiddenIds', () => {
    const { folders } = mergeAdminAndRegistry(
      [],
      reg,
      root,
      new Map([
        ['f-open', 'Open'],
        ['f-secret', 'Restricted'],
      ]),
      new Set(['f-secret']),
    );
    expect(folders.map((f) => f.id)).toEqual(['f-open']);
  });

  it('keeps every folder when hiddenIds is undefined (back-compat)', () => {
    const { folders } = mergeAdminAndRegistry([], reg, root);
    expect(folders.map((f) => f.id).sort()).toEqual(['f-open', 'f-secret']);
  });

  it('keeps every folder when hiddenIds is empty', () => {
    const { folders } = mergeAdminAndRegistry([], reg, root, undefined, new Set());
    expect(folders.map((f) => f.id).sort()).toEqual(['f-open', 'f-secret']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir app exec vitest run src/hooks/__tests__/useWorkspaceTree.test.ts`
Expected: FAIL — `mergeAdminAndRegistry` ignores the 5th arg, so `f-secret` is still present (first test fails on `toEqual(['f-open'])`).

- [ ] **Step 3: Add the `hiddenIds` param + filter**

In `app/src/hooks/useWorkspaceTree.ts`, change the signature and the `.filter(...)`:

```ts
export function mergeAdminAndRegistry(
  admin: AdminSubgroup[],
  registry: RegistryFolderShape[],
  rootId: string,
  visibilityById?: Map<string, 'Open' | 'Restricted'>,
  // Folder ids the current caller is NOT allowed to see (their
  // per-folder getGroupInfo came back access-denied). Restricted
  // folders the caller isn't a member of land here and are dropped
  // from the tree entirely — they never appear in the rail.
  hiddenIds?: Set<string>,
): { folders: MergedFolder[] } {
  const adminById = new Map(admin.map((a) => [a.groupId, a]));
  const folders: MergedFolder[] = registry
    .filter((r) => r.id !== rootId && !(hiddenIds?.has(r.id) ?? false))
    .map((r) => {
      const a = adminById.get(r.id);
      const alias = a?.name ?? r.alias ?? `folder-${r.id.slice(0, 8)}`;
      return {
        id: r.id,
        parent_id: r.parent_id,
        alias,
        visibility: visibilityById?.get(r.id),
        color: r.color,
      };
    });
  return { folders };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir app exec vitest run src/hooks/__tests__/useWorkspaceTree.test.ts`
Expected: PASS (all three new cases + existing cases).

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useWorkspaceTree.ts app/src/hooks/__tests__/useWorkspaceTree.test.ts
git commit -m "feat(folders): add hiddenIds filter to mergeAdminAndRegistry"
```

---

### Task A2: Feed access-denied folders into the hidden set

**Files:**
- Modify: `app/src/hooks/useDriveWorkspace.ts:582-657` (the `getGroupInfo` fan-out + `folders` memo)

This task is hook wiring against the live SDK; it's verified by typecheck (this task) and manual e2e (Task B4 covers the full path). No isolated unit test — the filter logic itself is covered by A1.

- [ ] **Step 1: Import the access-denied classifier**

At the top of `app/src/hooks/useDriveWorkspace.ts`, with the other `@/utils` imports, add:

```ts
import { isAccessDeniedError } from '@/utils/accessDenied';
```

- [ ] **Step 2: Track a `hiddenFolderIds` set alongside aliases/visibilities**

In the fan-out block (currently `const [aliases, …]` / `const [visibilities, …]` around line 582), add a third state and populate it. Replace the existing fan-out effect body so each folder's fetch reports an access-denied flag, and a folder is hidden ONLY on a definitive access-denied (not on a transient network error):

```ts
const [aliases, setAliases] = useState<Map<string, string>>(new Map());
const [visibilities, setVisibilities] = useState<
  Map<string, 'Open' | 'Restricted'>
>(new Map());
// Folders the caller may NOT see — their getGroupInfo came back
// "not a member" (core rejects non-members of restricted subgroups,
// crates/context/.../get_group_info.rs). These are filtered out of
// the rail. A folder leaves this set automatically once the caller
// is added: the SSE-driven refetch re-runs this fan-out and the
// getGroupInfo then succeeds. Only a *definitive* access-denied
// hides a folder; transient (5xx/network) errors keep it visible.
const [hiddenFolderIds, setHiddenFolderIds] = useState<Set<string>>(
  new Set(),
);
const [aliasRevision, setAliasRevision] = useState(0);
useEffect(() => {
  if (!mero) return;
  const ids = regFolders.map((f) => f.id);
  if (ids.length === 0) {
    setAliases(new Map());
    setVisibilities(new Map());
    setHiddenFolderIds(new Set());
    return;
  }
  let alive = true;
  Promise.all(
    ids.map((id) =>
      mero.admin
        .getGroupInfo(id)
        .then(
          (info) =>
            [
              id,
              info?.metadata?.name ?? null,
              info?.subgroupVisibility ?? null,
              false, // not access-denied
            ] as const,
        )
        .catch(
          (e) =>
            [id, null, null, isAccessDeniedError(e)] as const,
        ),
    ),
  ).then((entries) => {
    if (!alive) return;
    const nextAliases = new Map<string, string>();
    const nextVis = new Map<string, 'Open' | 'Restricted'>();
    const nextHidden = new Set<string>();
    for (const [id, alias, vis, denied] of entries) {
      if (denied) nextHidden.add(id);
      if (alias) nextAliases.set(id, alias);
      const norm =
        vis === 'Open' || vis === 'open'
          ? 'Open'
          : vis === 'Restricted' || vis === 'restricted'
            ? 'Restricted'
            : null;
      if (norm) nextVis.set(id, norm);
    }
    setAliases(nextAliases);
    setVisibilities(nextVis);
    setHiddenFolderIds(nextHidden);
  });
  return () => {
    alive = false;
  };
}, [mero, regFolders, aliasRevision]);
```

- [ ] **Step 3: Pass `hiddenFolderIds` into the merge**

In the `folders` useMemo (currently around line 642-657), pass the set as the new 5th arg and add it to the deps array:

```ts
const folders = useMemo<MergedFolder[]>(() => {
  if (!rootGroupId) return [];
  const admin: AdminSubgroup[] = regFolders.map((f) => {
    const aliasFromCache = aliases.get(f.id);
    const nameFromSubgroups = (subgroups ?? []).find(
      (s) => s.groupId === f.id,
    )?.name;
    return {
      groupId: f.id,
      parent_id: f.parent_id,
      name: aliasFromCache ?? nameFromSubgroups,
    };
  });
  return mergeAdminAndRegistry(
    admin,
    regFolders,
    rootGroupId,
    visibilities,
    hiddenFolderIds,
  ).folders;
}, [rootGroupId, subgroups, regFolders, aliases, visibilities, hiddenFolderIds]);
```

- [ ] **Step 4: Typecheck**

Run (from `app/`): `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: EXIT 0, no errors.

- [ ] **Step 5: Run the folder/workspace unit suites for regressions**

Run: `pnpm --dir app exec vitest run src/hooks/__tests__/useWorkspaceTree.test.ts src/hooks/__tests__/useFolderAccess.test.ts`
Expected: PASS. (Orphan note: if a hidden parent has a still-visible child — a member added to a deep restricted folder but not its parent — `buildTree` promotes that child to a root, so it still renders. No extra handling needed.)

- [ ] **Step 6: Commit**

```bash
git add app/src/hooks/useDriveWorkspace.ts
git commit -m "feat(folders): hide restricted folders the caller can't access from the rail"
```

---

## Part B — Pick members at folder creation (auto-added, on-open join)

### Task B1: `useFolderOperations.create` adds chosen members

**Files:**
- Modify: `app/src/hooks/useFolderOperations.ts:29-37` (input type), `:62-202` (the `create` callback)
- Test: `app/src/hooks/__tests__/useFolderOperations.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `app/src/hooks/__tests__/useFolderOperations.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Capture the mero-react mutation mocks so assertions can read call args.
const createGroupInNamespace = vi.fn();
const setSubgroupVisibility = vi.fn();
const setGroupMetadata = vi.fn();
const createContext = vi.fn();
const deleteContext = vi.fn();
const deleteGroup = vi.fn();
const addGroupMembers = vi.fn();

vi.mock('@calimero-network/mero-react', () => ({
  useCreateGroupInNamespace: () => ({ createGroupInNamespace }),
  useCreateContext: () => ({ createContext }),
  useDeleteContext: () => ({ deleteContext }),
  useDeleteGroup: () => ({ deleteGroup }),
  useSetGroupMetadata: () => ({ setGroupMetadata }),
  useSetSubgroupVisibility: () => ({ setSubgroupVisibility }),
  useAddGroupMembers: () => ({ addGroupMembers }),
  useMero: () => ({ nodeUrl: 'http://node' }),
}));

import { useFolderOperations } from '../useFolderOperations';

function makeRegistry() {
  return {
    registerFolder: vi.fn().mockResolvedValue(undefined),
    bindFolderContext: vi.fn().mockResolvedValue(undefined),
    unregisterFolder: vi.fn().mockResolvedValue(undefined),
    getFolderContext: vi.fn(),
  } as unknown as Parameters<typeof useFolderOperations>[0];
}

const ROOT = 'root-group';

beforeEach(() => {
  vi.clearAllMocks();
  createGroupInNamespace.mockResolvedValue({ groupId: 'new-folder' });
  setSubgroupVisibility.mockResolvedValue(undefined);
  setGroupMetadata.mockResolvedValue(undefined);
  createContext.mockResolvedValue({ contextId: 'docs-ctx' });
  addGroupMembers.mockResolvedValue(undefined);
});

describe('useFolderOperations.create — members', () => {
  it('adds each chosen member (role "member") after the folder is bound', async () => {
    const registry = makeRegistry();
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useFolderOperations(registry, ROOT, [], 'app-1', refetch),
    );

    await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: ROOT,
      alias: 'Secret',
      visibility: 'Restricted',
      members: ['member-a', 'member-b'],
    });

    expect(addGroupMembers).toHaveBeenCalledWith('new-folder', {
      members: [
        { identity: 'member-a', role: 'member' },
        { identity: 'member-b', role: 'member' },
      ],
    });
    // Ordering: members are added only after the context is bound.
    expect(
      (registry as unknown as { bindFolderContext: { mock: { invocationCallOrder: number[] } } })
        .bindFolderContext.mock.invocationCallOrder[0],
    ).toBeLessThan(addGroupMembers.mock.invocationCallOrder[0]);
  });

  it('does not call addGroupMembers when no members are given', async () => {
    const registry = makeRegistry();
    const { result } = renderHook(() =>
      useFolderOperations(registry, ROOT, [], 'app-1', vi.fn().mockResolvedValue(undefined)),
    );
    await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: ROOT,
      alias: 'Open one',
      visibility: 'Open',
    });
    expect(addGroupMembers).not.toHaveBeenCalled();
  });

  it('member-add failure does NOT roll back the created folder', async () => {
    const registry = makeRegistry();
    addGroupMembers.mockRejectedValue(new Error('add boom'));
    const { result } = renderHook(() =>
      useFolderOperations(registry, ROOT, [], 'app-1', vi.fn().mockResolvedValue(undefined)),
    );

    const id = await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: ROOT,
      alias: 'Secret',
      visibility: 'Restricted',
      members: ['member-a'],
    });

    expect(id).toBe('new-folder');
    // Folder stays created: rollback paths must NOT fire.
    expect(
      (registry as unknown as { unregisterFolder: ReturnType<typeof vi.fn> }).unregisterFolder,
    ).not.toHaveBeenCalled();
    expect(deleteContext).not.toHaveBeenCalled();
    expect(deleteGroup).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir app exec vitest run src/hooks/__tests__/useFolderOperations.test.ts`
Expected: FAIL — `useAddGroupMembers` isn't imported/used yet (mock unused), `create` doesn't accept `members`, and `addGroupMembers` is never called.

- [ ] **Step 3: Add `members` to the input type**

In `app/src/hooks/useFolderOperations.ts`, extend `CreateFolderInput`:

```ts
export interface CreateFolderInput {
  namespaceId: string;
  parentGroupId: string;
  alias: string;
  color?: string | null;
  /** 'Open' = namespace members inherit access (the default).
   *  'Restricted' = explicit invite required (per-subgroup wall). */
  visibility: 'Open' | 'Restricted';
  /** Identities to add to the new subgroup immediately (Restricted
   *  folders only — Open folders inherit members from the namespace).
   *  Added best-effort as the final create step; a failure here does
   *  NOT roll back the folder. */
  members?: string[];
}
```

- [ ] **Step 4: Wire the `useAddGroupMembers` hook**

Add the import to the existing `@calimero-network/mero-react` import block and destructure it next to the other mutation hooks:

```ts
import {
  useCreateGroupInNamespace,
  useCreateContext,
  useDeleteContext,
  useDeleteGroup,
  useSetGroupMetadata,
  useSetSubgroupVisibility,
  useAddGroupMembers,
  useMero,
} from '@calimero-network/mero-react';
```

```ts
const { setSubgroupVisibility } = useSetSubgroupVisibility();
const { addGroupMembers } = useAddGroupMembers();
const { nodeUrl } = useMero();
```

- [ ] **Step 5: Add the best-effort member-add as the final create step**

In `create`, immediately after the existing `bindFolderContext` call and before `await refetch();`, insert:

```ts
await registryClient.bindFolderContext({
  folder_id: newId,
  context_id: ctx.contextId,
});

// Add chosen members LAST — the folder + docs context already exist
// and are bound, so the folder is fully usable even if this step
// fails. Best-effort: a failure here is logged but must NOT trigger
// the rollback below (that's for failures that leave a half-built
// folder). Admins can re-add via the sharing panel. Open folders
// pass no members (namespace inheritance covers them).
if (input.members && input.members.length > 0) {
  try {
    await addGroupMembers(newId, {
      members: input.members.map((identity) => ({
        identity,
        role: 'member',
      })),
    });
  } catch (e) {
    console.warn('create: addGroupMembers failed (folder kept)', e);
  }
}

await refetch();
return newId;
```

Then add `addGroupMembers` to the `useCallback` dependency array (alongside `setSubgroupVisibility`, etc.).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --dir app exec vitest run src/hooks/__tests__/useFolderOperations.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 7: Commit**

```bash
git add app/src/hooks/useFolderOperations.ts app/src/hooks/__tests__/useFolderOperations.test.ts
git commit -m "feat(folders): add chosen members during folder creation"
```

---

### Task B2: Member-picker in `NewFolderDialog` (Restricted only)

**Files:**
- Modify: `app/src/components/folders/NewFolderDialog.tsx`
- Test: `app/src/components/folders/__tests__/NewFolderDialog.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `app/src/components/folders/__tests__/NewFolderDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const create = vi.fn().mockResolvedValue('new-folder');

vi.mock('@/hooks/useFolderOperations', () => ({
  useFolderOperations: () => ({ create, rename: vi.fn(), remove: vi.fn() }),
}));

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns-1',
    rootGroupId: 'root-group',
    folders: [],
    registryClient: {},
    applicationId: 'app-1',
    refetch: vi.fn(),
    selfIdentity: 'me',
  }),
}));

// Stub the picker so the test can drive onSelect without the SDK.
vi.mock('@/components/common/MemberPicker', () => ({
  MemberPicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('member-a')}>
      add-member-a
    </button>
  ),
}));

import { NewFolderDialog } from '../NewFolderDialog';

beforeEach(() => vi.clearAllMocks());

describe('NewFolderDialog member-picker', () => {
  it('hides the member-picker for Open folders', () => {
    render(<NewFolderDialog parentFolderId={null} onClose={vi.fn()} />);
    expect(screen.queryByText('add-member-a')).toBeNull();
  });

  it('shows the picker for Restricted and passes selected members to create', async () => {
    render(<NewFolderDialog parentFolderId={null} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restricted' }));
    fireEvent.click(screen.getByText('add-member-a')); // picker fires onSelect
    fireEvent.change(screen.getByPlaceholderText('Folder name'), {
      target: { value: 'Secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          alias: 'Secret',
          visibility: 'Restricted',
          members: ['member-a'],
        }),
      ),
    );
  });

  it('sends no members when visibility stays Open', async () => {
    render(<NewFolderDialog parentFolderId={null} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Folder name'), {
      target: { value: 'Public' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'Open', members: [] }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir app exec vitest run src/components/folders/__tests__/NewFolderDialog.test.tsx`
Expected: FAIL — no picker is rendered for Restricted, and `create` is called without a `members` field.

- [ ] **Step 3: Add member state + picker UI to the dialog**

In `app/src/components/folders/NewFolderDialog.tsx`:

Add imports:

```tsx
import { MemberPicker } from '@/components/common/MemberPicker';
```

Pull `selfIdentity` from the workspace hook (extend the existing destructure):

```tsx
const {
  namespaceId,
  rootGroupId,
  folders,
  registryClient,
  applicationId,
  refetch,
  selfIdentity,
} = useDriveWorkspace();
```

Add selected-members state next to the other `useState`s:

```tsx
// Identities to add immediately (Restricted folders only). The
// creator is already the group admin, so exclude self from the picker.
const [members, setMembers] = useState<string[]>([]);
```

Render the picker + chips inside the form, directly after the Visibility block (the closing `</div>` of the visibility `grid`), gated on Restricted:

```tsx
{visibility === 'Restricted' && (
  <div className="block text-sm">
    <span className="mb-1 block text-muted-foreground">
      Members (added now)
    </span>
    <MemberPicker
      namespaceId={namespaceId}
      exclude={[...members, ...(selfIdentity ? [selfIdentity] : [])]}
      disabled={submitting}
      ariaLabel="Add member to folder"
      onSelect={(identity) =>
        setMembers((prev) =>
          prev.includes(identity) ? prev : [...prev, identity],
        )
      }
    />
    {members.length > 0 && (
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {members.map((m) => (
          <li
            key={m}
            className="flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs"
          >
            <code className="truncate">{m.slice(0, 12)}…</code>
            <button
              type="button"
              aria-label={`Remove ${m}`}
              disabled={submitting}
              onClick={() =>
                setMembers((prev) => prev.filter((x) => x !== m))
              }
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    )}
  </div>
)}
```

- [ ] **Step 4: Pass members to `create`**

In `onCreate`, update the `ops.create({...})` call to include members (only for Restricted — Open folders inherit, so send an empty list):

```tsx
await ops.create({
  namespaceId,
  parentGroupId: parentFolderId ?? rootGroupId,
  alias,
  color: color || null,
  visibility,
  members: visibility === 'Restricted' ? members : [],
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --dir app exec vitest run src/components/folders/__tests__/NewFolderDialog.test.tsx`
Expected: PASS (all three cases).

- [ ] **Step 6: Typecheck + commit**

Run (from `app/`): `pnpm exec tsc --noEmit -p tsconfig.json` → EXIT 0

```bash
git add app/src/components/folders/NewFolderDialog.tsx app/src/components/folders/__tests__/NewFolderDialog.test.tsx
git commit -m "feat(folders): pick members when creating a restricted folder"
```

---

### Task B3: Full suite + lint gate

**Files:** none (verification)

- [ ] **Step 1: Run the whole unit suite**

Run: `pnpm --dir app exec vitest run`
Expected: PASS (no regressions; ~157+ tests green per the repo baseline).

- [ ] **Step 2: Lint**

Run: `pnpm --dir app lint`
Expected: 0 warnings/errors (repo runs `--max-warnings 0`).

- [ ] **Step 3: Typecheck**

Run (from `app/`): `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: EXIT 0.

---

### Task B4: Manual two-node e2e verification (recipient side — no code)

The added member's experience relies on existing machinery (`useMemberCaps` SSE refresh + `useDocs` self-heal). Verify it end-to-end. There's an existing harness: `app/e2e/two-node/restricted-folder-invite.spec.ts` and `pnpm --dir app e2e:two-node`.

- [ ] **Step 1: Alice creates a Restricted folder and picks Bob at creation**

Confirm the new member-picker appears only after choosing "Restricted", Bob is selectable, and the folder is created.

- [ ] **Step 2: On Bob's node, the folder appears WITHOUT manual action**

Expected: once Bob's node syncs the `MemberAdded` op, the folder shows up in Bob's rail (Part A keeps it hidden until he's a member, then un-hides on the SSE refetch). Bob should NOT see an "ask admin" card.

- [ ] **Step 3: Bob opens the folder; documents sync with no "Join" click**

Expected: opening triggers `useDocs` self-heal (`joinContext`), and the doc list loads. Bob can read; editing is allowed (registry role defaults to Editor).

- [ ] **Step 4: A non-member (Carol, not added) never sees the folder**

Expected: the Restricted folder is absent from Carol's rail entirely — no card, no name leak.

- [ ] **Step 5: Note if any step fails**

If Step 3 fails (docs don't load after opening), the gap is recipient-side join timing — revisit the proactive-join option (mero-chat's `enrichEntries` pattern) deferred from this plan.

---

## Self-Review

**1. Spec coverage:**
- A "hide restricted folders from non-members, no card" → Tasks A1 (filter) + A2 (feed access-denied into the set). Covered.
- B "pick members at creation, auto-added" → Tasks B1 (create adds members) + B2 (picker UI). Covered.
- B "no manual action; docs sync when they open it" → recipient side is existing machinery; verified in B4. Covered (no code by design — confirmed `useMemberCaps:114` SSE refresh + `useDocs:200-215` heal).

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every code step has full code. OK.

**3. Type consistency:**
- `mergeAdminAndRegistry(admin, registry, rootId, visibilityById?, hiddenIds?)` — 5th param `hiddenIds?: Set<string>` used identically in A1 (signature) and A2 (call site). ✓
- `CreateFolderInput.members?: string[]` defined in B1, consumed in B1 (`input.members`) and B2 (`members:` in `create` call). ✓
- `addGroupMembers(groupId, { members: [{ identity, role }] })` matches `AddGroupMembersRequest = { members: GroupMemberInput[] }`, `GroupMemberInput = { identity: string; role: string }`. ✓ (role `'member'` matches `useFolderMembership` default.)
- `MemberPicker` props used (`namespaceId`, `exclude`, `disabled`, `ariaLabel`, `onSelect`) all exist on its `Props`. ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-restricted-folders-hide-and-autojoin.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
