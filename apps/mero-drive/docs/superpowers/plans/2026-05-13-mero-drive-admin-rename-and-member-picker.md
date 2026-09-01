# Mero Drive — Admin rename + member-picker autocomplete Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Two related UX upgrades on top of PR #39 (member display names):

1. **Admin override** — an admin (caller has `CAN_MANAGE_METADATA` or is a core namespace-admin) can rename *any* member's display name from `NamespaceMemberRow`. PR #39 deliberately made `useMemberDisplayName.setName` self-only-by-contract; this PR adds a separate, admin-gated rename surface.
2. **Member-picker autocomplete** — replace the two raw "paste a 44-char base58 pubkey" inputs (the add-manager form in `WorkspaceSettingsPanel`, and the add-member form in `FolderSharingPanel` for Restricted folders) with a `<MemberPicker>` combobox: filters the namespace's existing members by display name *and* pubkey prefix; selecting one fills the underlying identity.

**Tech stack:** React + TS + Vitest. mero-react `useGroupMembers(rootGroupId) → { members: GroupMember[], selfIdentity, loading, error, refetch }` where `GroupMember { identity, role, name? }`. `useSetMemberMetadata() → { setMemberMetadata(groupId, identity, { name, data }), loading, error }`. Existing surfaces: `useMemberDisplayName(ns, id)`, `useMemberCaps(ns, groupId) → { caps, isAdmin, error }`, `useNamespacePermissions(ns, rootGroupId) → { canManageMetadata, canManageNamespace, ... }`, `<MemberLabel namespaceId memberId isSelf? fallback? />`, `<NamespaceMemberRow groupId identity label role isSelf canManage onRemove />`. Worktree `/Users/beast/Developer/Calimero/mero-drive--open-restricted`, branch `feat/admin-rename-and-autocomplete` (already created off `refactor/frontend-battleships-alignment` @ `039f6ed`). Run from repo root: `pnpm --dir app exec tsc --noEmit`, `pnpm --dir app test --run`, `pnpm --dir app lint`, `pnpm --dir app build`. Do NOT `pnpm install`.

---

## Task 1: `useAdminRenameMember` hook

**Files:** new `app/src/hooks/useAdminRenameMember.ts`, new `app/src/hooks/__tests__/useAdminRenameMember.test.ts`.

Reasons it's a separate hook (not a fork of `useMemberDisplayName`):
- `useMemberDisplayName.setName` is self-only-by-contract (throws when `memberId !== selfIdentity`). The admin path needs the *opposite* binding (target = the member being renamed).
- It needs to know the caller's caps to gate the UI affordance (`canRename`).
- It's used in a different UI flow (inline-edit in a row, with cancel/save), not the self settings panel.

- [ ] **Step 1: TDD-write the failing test** at `useAdminRenameMember.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAdminRenameMember, MAX_DISPLAY_NAME_LEN } from '../useAdminRenameMember';

const setMemberMetadataFn = vi.fn();
const useMemberCapsMock = vi.fn();
vi.mock('@calimero-network/mero-react', () => ({
  useSetMemberMetadata: () => ({ setMemberMetadata: setMemberMetadataFn, loading: false, error: null }),
}));
vi.mock('../useMemberCaps', () => ({
  useMemberCaps: (...a: unknown[]) => useMemberCapsMock(...a),
}));
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ selfIdentity: 'self', rootGroupId: 'root' }),
}));

describe('useAdminRenameMember', () => {
  beforeEach(() => {
    setMemberMetadataFn.mockReset();
    useMemberCapsMock.mockReset();
  });

  it('canRename true when caller is core admin', () => {
    useMemberCapsMock.mockReturnValue({ caps: 0, isAdmin: true, error: null });
    const { result } = renderHook(() => useAdminRenameMember('ns', 'someone'));
    expect(result.current.canRename).toBe(true);
  });

  it('canRename true when caller has CAN_MANAGE_METADATA bit', () => {
    useMemberCapsMock.mockReturnValue({ caps: 256, isAdmin: false, error: null }); // 256 = CAN_MANAGE_METADATA
    const { result } = renderHook(() => useAdminRenameMember('ns', 'someone'));
    expect(result.current.canRename).toBe(true);
  });

  it('canRename false otherwise', () => {
    useMemberCapsMock.mockReturnValue({ caps: 37, isAdmin: false, error: null });
    const { result } = renderHook(() => useAdminRenameMember('ns', 'someone'));
    expect(result.current.canRename).toBe(false);
  });

  it('renameTo calls setMemberMetadata for the target member', async () => {
    useMemberCapsMock.mockReturnValue({ caps: 0, isAdmin: true, error: null });
    setMemberMetadataFn.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAdminRenameMember('ns', 'target-id'));
    await act(async () => { await result.current.renameTo('Alice'); });
    expect(setMemberMetadataFn).toHaveBeenCalledWith('ns', 'target-id', { name: 'Alice', data: {} });
  });

  it('renameTo throws when canRename is false', async () => {
    useMemberCapsMock.mockReturnValue({ caps: 37, isAdmin: false, error: null });
    const { result } = renderHook(() => useAdminRenameMember('ns', 'target-id'));
    await expect(result.current.renameTo('Alice')).rejects.toThrow(/permission/i);
    expect(setMemberMetadataFn).not.toHaveBeenCalled();
  });

  it('renameTo trims and rejects empty / over-max', async () => {
    useMemberCapsMock.mockReturnValue({ caps: 0, isAdmin: true, error: null });
    const { result } = renderHook(() => useAdminRenameMember('ns', 'target-id'));
    await expect(result.current.renameTo('   ')).rejects.toThrow(/empty/);
    await expect(result.current.renameTo('x'.repeat(MAX_DISPLAY_NAME_LEN + 1))).rejects.toThrow(new RegExp(`${MAX_DISPLAY_NAME_LEN}`));
  });

  it('renameTo refuses to write to self (use useMemberDisplayName)', async () => {
    useMemberCapsMock.mockReturnValue({ caps: 0, isAdmin: true, error: null });
    const { result } = renderHook(() => useAdminRenameMember('ns', 'self'));
    await expect(result.current.renameTo('Me')).rejects.toThrow(/self/);
  });
});
```

- [ ] **Step 2: implement** `useAdminRenameMember.ts`:

```ts
// Admin-only path for renaming a *different* member's display name.
// Pair this with useMemberDisplayName which is self-only-by-contract;
// this hook is the explicit other-member surface, gated on the caller
// holding CAN_MANAGE_METADATA or being a core group-admin. The server
// validates the same authz, so this is also defense-in-depth.

import { useCallback } from 'react';
import { useSetMemberMetadata } from '@calimero-network/mero-react';
import { CAPABILITIES, hasCap } from '../constants/config';
import { useDriveWorkspace } from './useDriveWorkspace';
import { useMemberCaps } from './useMemberCaps';

export { MAX_DISPLAY_NAME_LEN } from './useMemberDisplayName';
import { MAX_DISPLAY_NAME_LEN } from './useMemberDisplayName';

export interface AdminRenameMember {
  /** True iff the caller is allowed to rename `memberId` (admin role or
   *  CAN_MANAGE_METADATA on the namespace root). */
  canRename: boolean;
  /** Set `memberId`'s display name. Throws when:
   *    - the trimmed name is empty,
   *    - the name exceeds MAX_DISPLAY_NAME_LEN,
   *    - the caller lacks permission,
   *    - the target is the caller (use useMemberDisplayName for self-edits). */
  renameTo: (name: string) => Promise<void>;
}

export function useAdminRenameMember(
  namespaceId: string | null | undefined,
  memberId: string | null | undefined,
): AdminRenameMember {
  const { selfIdentity, rootGroupId } = useDriveWorkspace();
  const { caps, isAdmin } = useMemberCaps(namespaceId ?? '', rootGroupId ?? '');
  const { setMemberMetadata } = useSetMemberMetadata();

  const canRename =
    isAdmin ||
    (caps !== null && hasCap(caps, CAPABILITIES.CAN_MANAGE_METADATA));

  const renameTo = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      if (!trimmed) throw new Error('display name cannot be empty');
      if (trimmed.length > MAX_DISPLAY_NAME_LEN) {
        throw new Error(
          `display name must be ${MAX_DISPLAY_NAME_LEN} characters or fewer`,
        );
      }
      if (!namespaceId) throw new Error('namespaceId required');
      if (!memberId) throw new Error('memberId required');
      if (selfIdentity && memberId === selfIdentity) {
        throw new Error(
          'renameTo refuses self — use useMemberDisplayName.setName for self edits',
        );
      }
      if (!canRename) {
        throw new Error('no permission to rename other members');
      }
      await setMemberMetadata(namespaceId, memberId, {
        name: trimmed,
        data: {},
      });
    },
    [namespaceId, memberId, selfIdentity, canRename, setMemberMetadata],
  );

  return { canRename, renameTo };
}
```

  (NB. `MAX_DISPLAY_NAME_LEN` is re-exported from `useMemberDisplayName.ts` — keep one canonical value.)

- [ ] **Step 3:** `pnpm --dir app test --run useAdminRenameMember` → all pass. `tsc` clean.
- [ ] **Step 4: Commit** — `feat(app): useAdminRenameMember hook (admin-gated other-member rename)`.

---

## Task 2: Pencil-edit affordance on `NamespaceMemberRow`

**Files:** modify `app/src/components/admin/NamespaceMemberRow.tsx`. Maybe extend `permission-gating.test.tsx`.

- [ ] **Step 1:** Add an inline-edit affordance to the right of the member's name display (NOT a separate column — kept compact). Visible only when `canRename` from `useAdminRenameMember(namespaceId, identity)` is true AND `identity !== selfIdentity`. UX:
  - Default: just the `<MemberLabel>`.
  - Click the pencil icon (`Pencil` from `lucide-react`) → swap into a small inline input + Save (✓) + Cancel (✗) buttons. Input prefilled with `name ?? ''`. Save calls `renameTo(input)`; on success exit edit mode + refetch the row's `useMemberMetadata` so the new name shows. Surface errors inline below the row.
  - The row already shows `MemberLabel` for self — we use the *same* row for self but the affordance is gated off (`identity === selfIdentity` → don't show pencil; user uses the `MyDisplayNamePanel` self surface above).
  - Get `namespaceId` and `selfIdentity` from `useDriveWorkspace()`.

- [ ] **Step 2:** A small targeted test in `permission-gating.test.tsx` (or a new `NamespaceMemberRow.test.tsx`): pencil is hidden when `canRename` mock returns false; visible when true; clicking it switches to edit mode; saving fires `renameTo`. Mock `useAdminRenameMember`, `useMemberDisplayName`, `useDriveWorkspace`.

- [ ] **Step 3:** `tsc` / lint / test / build green.
- [ ] **Step 4: Commit** — `feat(app): inline admin rename affordance on NamespaceMemberRow`.

---

## Task 3: `<MemberPicker>` combobox

**Files:** new `app/src/components/common/MemberPicker.tsx`, new `app/src/components/__tests__/MemberPicker.test.tsx`.

- [ ] **Step 1: write the failing test**:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemberPicker } from '../common/MemberPicker';

const members = [
  { identity: 'alice-pubkey-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', role: 'Member' },
  { identity: 'bob-pubkey-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', role: 'Member' },
  { identity: 'cathy-pubkey-cccccccccccccccccccccccccccccccccc', role: 'Member' },
];
const useGroupMembersMock = vi.fn();
vi.mock('@calimero-network/mero-react', () => ({
  useGroupMembers: (...a: unknown[]) => useGroupMembersMock(...a),
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: (_ns: string, mid: string) => ({
    name: mid.startsWith('alice') ? 'Alice' : mid.startsWith('bob') ? null : null,
    loading: false, error: null, setName: async () => {},
  }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ rootGroupId: 'root', selfIdentity: 'self' }),
}));

beforeEach(() => useGroupMembersMock.mockReturnValue({ members, selfIdentity: 'self', loading: false, error: null, refetch: vi.fn() }));

describe('MemberPicker', () => {
  it('renders nothing in the dropdown until input is focused', () => {
    const onSelect = vi.fn();
    render(<MemberPicker namespaceId="ns" onSelect={onSelect} />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
  it('shows all members when focused with empty query', () => {
    render(<MemberPicker namespaceId="ns" onSelect={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });
  it('filters by display name (case-insensitive)', () => {
    render(<MemberPicker namespaceId="ns" onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ali' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
  it('filters by pubkey prefix', () => {
    render(<MemberPicker namespaceId="ns" onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'bob-pubkey' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });
  it('excludes identities passed in `exclude`', () => {
    render(<MemberPicker namespaceId="ns" exclude={[members[0].identity]} onSelect={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
  it('clicking an option calls onSelect with the identity and closes the dropdown', () => {
    const onSelect = vi.fn();
    render(<MemberPicker namespaceId="ns" onSelect={onSelect} />);
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('Alice'));
    expect(onSelect).toHaveBeenCalledWith(members[0].identity);
  });
  it('accepts a free-form pubkey paste via onCommit when no option matches', () => {
    const onSelect = vi.fn();
    render(<MemberPicker namespaceId="ns" onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    const paste = 'unknown-pubkey-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
    fireEvent.change(input, { target: { value: paste } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(paste);
  });
});
```

- [ ] **Step 2: implement** `MemberPicker.tsx`:

```tsx
// Combobox over the namespace's existing members. The "add manager" /
// "add member to restricted folder" flows used to be a raw text input
// expecting a 44-char base58 pubkey; this lets the admin start typing
// a name or a pubkey prefix and pick from the workspace member list.
// Free-form paste of an unknown pubkey still works (Enter commits the
// raw text via onSelect — the downstream form validates / sends).
//
// Props:
//   namespaceId — needed so each row can resolve its display name via
//                 <MemberLabel> (which calls useMemberDisplayName(ns, id)).
//   onSelect    — fired with the chosen identity. The parent decides
//                 what to do (set its own state, call the server, etc).
//   exclude     — identities to omit from the dropdown (e.g. existing
//                 managers / members already in the folder).
//   placeholder — passed through to the input.
//   ariaLabel
//   disabled

import React, { useMemo, useRef, useState } from 'react';
import { useGroupMembers } from '@calimero-network/mero-react';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useMemberDisplayName } from '@/hooks/useMemberDisplayName';
import { MemberLabel } from './MemberLabel';

interface Props {
  namespaceId: string | null | undefined;
  onSelect: (identity: string) => void;
  exclude?: string[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Optional className passthrough on the wrapper. */
  className?: string;
}

// Render-time helper: gives each member's display name (or null) so
// the filter can match on it. Implemented as a child component so the
// per-row useMemberDisplayName call is colocated with its render.
function MemberRow({
  namespaceId,
  identity,
  query,
  onPick,
  index,
}: {
  namespaceId: string | null | undefined;
  identity: string;
  query: string;
  onPick: (id: string) => void;
  index: number;
}) {
  const { name } = useMemberDisplayName(namespaceId, identity);
  const q = query.trim().toLowerCase();
  const matches =
    q.length === 0 ||
    (name && name.toLowerCase().includes(q)) ||
    identity.toLowerCase().startsWith(q);
  if (!matches) return null;
  return (
    <li role="option" aria-selected={false}>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onPick(identity);
        }}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
      >
        <MemberLabel
          namespaceId={namespaceId}
          memberId={identity}
          className="truncate"
        />
        <code className="ml-2 truncate text-[10px] text-muted-foreground">
          {identity.slice(0, 12)}…
        </code>
      </button>
    </li>
  );
}

export function MemberPicker({
  namespaceId,
  onSelect,
  exclude,
  placeholder = 'Search members or paste a pubkey…',
  ariaLabel,
  disabled,
  className,
}: Props) {
  const { rootGroupId } = useDriveWorkspace();
  const { members } = useGroupMembers(rootGroupId);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const excludeSet = useMemo(() => new Set(exclude ?? []), [exclude]);
  const candidates = useMemo(
    () => members.filter((m) => !excludeSet.has(m.identity)),
    [members, excludeSet],
  );

  const pick = (identity: string) => {
    onSelect(identity);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel ?? 'Pick a member'}
        aria-expanded={open}
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so a click on a dropdown row still registers.
          setTimeout(() => setOpen(false), 100);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && query.trim()) {
            // Free-form commit — the parent decides whether to accept
            // (it'll validate base58 format etc).
            e.preventDefault();
            pick(query.trim());
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      {open && candidates.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {candidates.map((m, idx) => (
            <MemberRow
              key={m.identity}
              namespaceId={namespaceId}
              identity={m.identity}
              query={query}
              onPick={pick}
              index={idx}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3:** Tests pass. `tsc` / lint clean.
- [ ] **Step 4: Commit** — `feat(app): MemberPicker combobox (name + pubkey-prefix autocomplete)`.

---

## Task 4: Adopt `MemberPicker` in the two add-by-identity forms

**Files:** modify `app/src/components/admin/WorkspaceSettingsPanel.tsx`, `app/src/components/folders/FolderSharingPanel.tsx`.

- [ ] **Step 1: WorkspaceSettingsPanel add-manager form.** Replace the existing input + button block with `<MemberPicker namespaceId exclude={[...reg.managers, reg.owner].filter(Boolean)} onSelect={(identity) => setManagerInput(identity)} />` followed by the existing "Add manager" button — pushed by the parent state, the button still does the validate-then-call dance. *Or* skip the intermediate state and have `onSelect` directly call `onAddManager(identity)` after running through `looksLikeMemberIdentity`. Pick the simpler version: keep the existing state (`managerInput`) and just feed it from the picker; the Add button is unchanged. That way the existing error-handling and `setAdminError` paths still work.
- [ ] **Step 2: FolderSharingPanel add-member form.** Similar swap — the picker excludes existing folder members (`members.map((m) => m.identity)`); `onSelect` fills the `identity` state. Keep the existing Add button + invite-link button next to it. For Open folders the form is hidden (no change there).
- [ ] **Step 3:** Update existing component tests that interact with the old input (probably none; the prior tests grep for the input by placeholder). If a test breaks, fix it minimally.
- [ ] **Step 4:** `tsc` / lint / test / build green.
- [ ] **Step 5: Commit** — `feat(app): adopt MemberPicker in add-manager and add-folder-member forms`.

---

## Task 5: Push + PR

- [ ] **Step 1:** `git push origin feat/admin-rename-and-autocomplete`.
- [ ] **Step 2:** `gh pr create --base refactor/frontend-battleships-alignment --head feat/admin-rename-and-autocomplete --title "feat(app): admin rename other members + member-picker autocomplete" --body-file <tmp>`. Body: cover the new `useAdminRenameMember` hook (authz = `CAN_MANAGE_METADATA` OR core admin), the `NamespaceMemberRow` pencil affordance (hidden for self / non-admins), the `MemberPicker` combobox (`useGroupMembers` source, filter on name + pubkey prefix, free-form Enter-to-commit for paste-an-unknown-pubkey), the two add-form adoptions, and what's still deferred (bulk-prefetch member names — N requests on first paint of a populated dropdown; mid-edit clobber from refetch). End with the Claude Code trailer.
- [ ] **Step 3:** Report: commits, gates, PR URL, files touched, any deviations.

## Self-review
- §5.5-style admin override surface: ✓ (`useAdminRenameMember` + the pencil affordance).
- Server gates other-edits on `CAN_MANAGE_METADATA` already; the client hook short-circuits with `canRename` so the affordance isn't shown to non-admins (defense-in-depth).
- The two raw-pubkey input forms now have an autocomplete; raw paste still works via Enter.
- No new mero-js / mero-react / core changes.
- No placeholders; every code step has the code.
