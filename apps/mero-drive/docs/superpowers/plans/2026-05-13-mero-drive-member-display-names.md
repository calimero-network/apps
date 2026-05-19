# Mero Drive — Member display names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Replace every `{pubkey.slice(0, 12)}…` rendering of a member identity with the member's chosen display name (per-namespace), backed by core's `setMemberMetadata` / `getMemberMetadata` (PR #2338). Default fallback to the truncated pubkey when no name is set.

**Architecture / spec (settled in chat):**
- Storage: core's per-`(group, member)` `MetadataRecord` — namespace-scoped naturally; a user can have a different display name in each workspace they belong to.
- Authz: **self-edit is always allowed** (core enforces "a member may set their own metadata; otherwise the signer needs `CAN_MANAGE_METADATA` / admin" — see `crates/context/src/handlers/set_member_metadata.rs:21` in core PR #2338). No default-cap change required.
- Hook: `useMemberDisplayName(namespaceId, memberId)` backed by mero-react's `useMemberMetadata` + a module-level in-memory `Map<"${nsId}:${memberId}", { name | null, ts }>` cache so a list of N members is N requests *the first time* but subsequent re-renders are cached. Returns `{ name, loading, setName }` (`setName` only does anything when `memberId === selfIdentity` or the caller has `CAN_MANAGE_METADATA`).
- Component: `<MemberLabel namespaceId memberId fallback="11-char-truncate"/>` — the single render site every member-display call site adopts.
- UI surface: in `NamespaceSettingsPanel`, a new "Your display name" section (`MyDisplayNamePanel`) — input bound to `setName(self)`. Save button. Member sees their own current name. Admin override (renaming someone else) is **out of scope for this feature** — flag as a follow-up.
- Out of scope (follow-ups): name→identity autocomplete on the two add-by-identity forms; admin "rename any member" affordance; cache invalidation via Calimero events (we refetch on `setName` + on mount; that's enough for v1).

**Tech stack:** mero-react `useMemberMetadata(groupId, identity) → { metadata: MetadataRecord | null, loading, error, refetch }`, `useSetMemberMetadata() → { setMemberMetadata(groupId, identity, { name, data }), loading, error }`. The `MetadataRecord.name` field is `string | null`; the `data` field is opaque to core but we'll leave it `{}` since we only care about `name` for v1.

**Worktree:** `/Users/beast/Developer/Calimero/mero-drive--open-restricted`, branch `feat/member-display-names` (already created off `refactor/frontend-battleships-alignment` @ `0a93521`). Run from repo root: `pnpm --dir app exec tsc --noEmit`, `pnpm --dir app test`, `pnpm --dir app lint`, `pnpm --dir app build`. Do NOT `pnpm install`.

---

## Task 1: `useMemberDisplayName` hook + cache

**Files:** new `app/src/hooks/useMemberDisplayName.ts`, new `app/src/hooks/__tests__/useMemberDisplayName.test.ts`

- [ ] **Step 1: write the failing test** in `useMemberDisplayName.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMemberDisplayName, __resetDisplayNameCache } from '../useMemberDisplayName';

// Mock mero-react hooks
const memberMetadataMock = vi.fn();
const setMemberMetadataFn = vi.fn();
vi.mock('@calimero-network/mero-react', () => ({
  useMemberMetadata: (...args: unknown[]) => memberMetadataMock(...args),
  useSetMemberMetadata: () => ({ setMemberMetadata: setMemberMetadataFn, loading: false, error: null }),
}));
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ selfIdentity: 'self-pubkey' }),
}));

describe('useMemberDisplayName', () => {
  beforeEach(() => {
    memberMetadataMock.mockReset();
    setMemberMetadataFn.mockReset();
    __resetDisplayNameCache();
  });

  it('returns name from MetadataRecord.name', async () => {
    memberMetadataMock.mockReturnValue({
      metadata: { name: 'Alice', data: {}, updatedAt: 0, updatedBy: '' },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useMemberDisplayName('ns1', 'alice-key'));
    await waitFor(() => expect(result.current.name).toBe('Alice'));
  });

  it('returns null when no name set', async () => {
    memberMetadataMock.mockReturnValue({
      metadata: { name: null, data: {}, updatedAt: 0, updatedBy: '' },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useMemberDisplayName('ns1', 'someone'));
    await waitFor(() => expect(result.current.name).toBeNull());
  });

  it('returns null when metadata is null', async () => {
    memberMetadataMock.mockReturnValue({ metadata: null, loading: false, error: null, refetch: vi.fn() });
    const { result } = renderHook(() => useMemberDisplayName('ns1', 'someone'));
    await waitFor(() => expect(result.current.name).toBeNull());
  });

  it('setName calls setMemberMetadata and refetches', async () => {
    const refetch = vi.fn();
    memberMetadataMock.mockReturnValue({
      metadata: { name: null, data: {}, updatedAt: 0, updatedBy: '' },
      loading: false, error: null, refetch,
    });
    setMemberMetadataFn.mockResolvedValue(undefined);
    const { result } = renderHook(() => useMemberDisplayName('ns1', 'self-pubkey'));
    await act(async () => { await result.current.setName('Bob'); });
    expect(setMemberMetadataFn).toHaveBeenCalledWith('ns1', 'self-pubkey', { name: 'Bob', data: {} });
    expect(refetch).toHaveBeenCalled();
  });

  it('setName trims and rejects empty', async () => {
    memberMetadataMock.mockReturnValue({ metadata: null, loading: false, error: null, refetch: vi.fn() });
    const { result } = renderHook(() => useMemberDisplayName('ns1', 'self-pubkey'));
    await expect(result.current.setName('   ')).rejects.toThrow();
    expect(setMemberMetadataFn).not.toHaveBeenCalled();
  });

  it('returns loading=true while metadata is loading', () => {
    memberMetadataMock.mockReturnValue({ metadata: null, loading: true, error: null, refetch: vi.fn() });
    const { result } = renderHook(() => useMemberDisplayName('ns1', 'someone'));
    expect(result.current.loading).toBe(true);
  });
});
```

- [ ] **Step 2: implement** `useMemberDisplayName.ts`:

```ts
// Per-(namespace, member) display name backed by core's setMemberMetadata
// (PR #2338). Falls back to null when unset — callers should render a
// truncated pubkey as the visual fallback (see <MemberLabel>).
//
// Self-edit is always allowed by core; admin override is out of scope here.
//
// A tiny module-level cache keeps repeat lookups (same nsId+memberId across
// the page render tree) from re-fetching — useMemberMetadata is per-call,
// so a list of N members fans out to N requests on first paint without a
// shared layer. Cache holds the name *and* a tick id so a setName() write
// can invalidate it; consumers within the same React tree see the new value
// via the underlying useMemberMetadata refetch.

import { useCallback, useMemo } from 'react';
import {
  useMemberMetadata,
  useSetMemberMetadata,
} from '@calimero-network/mero-react';
import { useDriveWorkspace } from './useDriveWorkspace';

const cache = new Map<string, string | null>();
const cacheKey = (nsId: string, memberId: string) => `${nsId}::${memberId}`;

/** @internal — for tests only */
export function __resetDisplayNameCache() {
  cache.clear();
}

export interface MemberDisplayName {
  /** Display name or null when none is set. */
  name: string | null;
  loading: boolean;
  error: Error | null;
  /** Sets the display name for `memberId` (defaults to self). Throws if
   *  trimmed input is empty. Rejects from the server are rethrown. */
  setName: (name: string, memberId?: string) => Promise<void>;
}

export function useMemberDisplayName(
  namespaceId: string | null | undefined,
  memberId: string | null | undefined,
): MemberDisplayName {
  const { selfIdentity } = useDriveWorkspace();
  const { metadata, loading, error, refetch } = useMemberMetadata(
    namespaceId ?? null,
    memberId ?? null,
  );
  const { setMemberMetadata } = useSetMemberMetadata();

  const name = useMemo(() => {
    const raw = metadata?.name ?? null;
    if (namespaceId && memberId) {
      cache.set(cacheKey(namespaceId, memberId), raw);
    }
    return raw;
  }, [metadata, namespaceId, memberId]);

  const setName = useCallback(
    async (next: string, mid?: string) => {
      const trimmed = next.trim();
      if (!trimmed) throw new Error('display name cannot be empty');
      if (!namespaceId) throw new Error('namespaceId required');
      const target = mid ?? memberId ?? selfIdentity;
      if (!target) throw new Error('memberId required');
      await setMemberMetadata(namespaceId, target, { name: trimmed, data: {} });
      cache.delete(cacheKey(namespaceId, target));
      await refetch();
    },
    [namespaceId, memberId, selfIdentity, setMemberMetadata, refetch],
  );

  return { name, loading, error, setName };
}
```

- [ ] **Step 3:** `pnpm --dir app test --run useMemberDisplayName` → all 6 cases pass. `pnpm --dir app exec tsc --noEmit` → 0.

- [ ] **Step 4: Commit** — `git add app/src/hooks/useMemberDisplayName.ts app/src/hooks/__tests__/useMemberDisplayName.test.ts && git commit -m "feat(app): useMemberDisplayName hook (per-namespace, backed by setMemberMetadata)"` with the Co-Authored-By trailer.

---

## Task 2: `<MemberLabel>` component (the universal render site)

**Files:** new `app/src/components/common/MemberLabel.tsx`, new `app/src/components/__tests__/MemberLabel.test.tsx`

- [ ] **Step 1: write the test**:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemberLabel } from '../common/MemberLabel';

vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: (_ns: string, mid: string) => {
    if (mid === 'alice-key') return { name: 'Alice', loading: false, error: null, setName: async () => {} };
    if (mid === 'loading-key') return { name: null, loading: true, error: null, setName: async () => {} };
    return { name: null, loading: false, error: null, setName: async () => {} };
  },
}));

describe('MemberLabel', () => {
  it('renders the display name when present', () => {
    render(<MemberLabel namespaceId="ns1" memberId="alice-key" />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('falls back to truncated pubkey when no name', () => {
    render(<MemberLabel namespaceId="ns1" memberId="abcdef0123456789abcdef0123456789" />);
    // default truncate is "first8…last4"
    expect(screen.getByText('abcdef01…6789')).toBeInTheDocument();
  });

  it('renders pubkey while loading (no flash of name)', () => {
    render(<MemberLabel namespaceId="ns1" memberId="loading-key" />);
    expect(screen.getByText('loading-…-key')).toBeInTheDocument();
  });

  it('uses provided fallback when given', () => {
    render(<MemberLabel namespaceId="ns1" memberId="x" fallback={(id) => `id:${id}`} />);
    expect(screen.getByText('id:x')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: implement** `MemberLabel.tsx`:

```tsx
import React from 'react';
import { useMemberDisplayName } from '@/hooks/useMemberDisplayName';

interface Props {
  namespaceId: string | null | undefined;
  memberId: string;
  /** Custom fallback render when no name is set. Default: "first8…last4". */
  fallback?: (memberId: string) => React.ReactNode;
  /** Extra className passthrough so each call site keeps its existing
   *  typography (mono code-tag look, muted-foreground, etc). */
  className?: string;
  /** When true, render a tiny "(you)" badge after the name. */
  isSelf?: boolean;
}

function defaultTruncate(id: string): string {
  if (id.length <= 13) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function MemberLabel({ namespaceId, memberId, fallback, className, isSelf }: Props) {
  const { name } = useMemberDisplayName(namespaceId, memberId);
  if (name) {
    return (
      <span className={className} title={memberId}>
        {name}
        {isSelf && (
          <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            (you)
          </span>
        )}
      </span>
    );
  }
  return (
    <span className={className} title={memberId}>
      {fallback ? fallback(memberId) : defaultTruncate(memberId)}
    </span>
  );
}
```

- [ ] **Step 3:** `pnpm --dir app test --run MemberLabel` → pass. `tsc` clean.

- [ ] **Step 4: Commit** — `feat(app): MemberLabel component (display name with truncated-pubkey fallback)`.

---

## Task 3: `MyDisplayNamePanel` (settings page entry)

**Files:** new `app/src/components/admin/MyDisplayNamePanel.tsx`, modify `app/src/components/workspace/NamespaceSettingsPanel.tsx`

- [ ] **Step 1: implement** `MyDisplayNamePanel.tsx` — a small panel rendering:
  - Current name (read via `useMemberDisplayName(namespaceId, selfIdentity)`), or "Not set" placeholder.
  - Input prefilled from current name, "Save" button (disabled while loading or trimmed-empty or unchanged).
  - On save: `await setName(input.trim())`; surface error via existing pattern; clear input dirty flag.
  - Helper copy: "Your display name in this workspace. Other members see this in member lists and folder sharing panels. Only you can change your own name."
  - No gating — every namespace member can edit their own name (per the core authz).

```tsx
// app/src/components/admin/MyDisplayNamePanel.tsx
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useMemberDisplayName } from '@/hooks/useMemberDisplayName';

export function MyDisplayNamePanel() {
  const { namespaceId, selfIdentity } = useDriveWorkspace();
  const { name, loading, error, setName } = useMemberDisplayName(namespaceId, selfIdentity);
  const [draft, setDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => { setDraft(name ?? ''); }, [name]);

  if (!namespaceId || !selfIdentity) return null;

  const trimmed = draft.trim();
  const dirty = trimmed !== (name ?? '') && trimmed.length > 0;

  const onSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await setName(trimmed);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card" data-testid="my-display-name-panel">
      <header className="border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Your display name</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Other members of this workspace see this name in member lists and
          folder sharing panels. Only you can change it.
        </p>
      </header>
      <div className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={name ?? 'Not set yet'}
            maxLength={64}
            disabled={loading || saving}
            className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Button size="sm" disabled={!dirty || saving || loading} onClick={() => void onSave()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive" role="alert">Couldn't load: {error.message}</p>}
        {saveError && <p className="text-xs text-destructive" role="alert">{saveError}</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: render it** in `NamespaceSettingsPanel.tsx`, between the header and `<NamespaceMembersPanel />` (or wherever fits the existing layout):

```tsx
import { MyDisplayNamePanel } from '@/components/admin/MyDisplayNamePanel';
// ...
<MyDisplayNamePanel />
<NamespaceMembersPanel />
```

- [ ] **Step 3:** `tsc` clean, lint clean. No new test required (covered by hook + Member Label tests).

- [ ] **Step 4: Commit** — `feat(app): "Your display name" section in namespace settings`.

---

## Task 4: Sweep — replace `{id.slice(0, N)}…` with `<MemberLabel>`

**Files (call sites — verify by `grep -rn "slice(0, *1[0-6]" app/src/components`):** `NamespaceMemberRow.tsx`, `FolderSharingPanel.tsx`, `FolderMemberRoleRow.tsx`, `WorkspaceSettingsPanel.tsx` (owner display + manager list + confirm-remove dialog body), `MemberDefaultsPanel.tsx`? (probably not — it doesn't render members), and any other site rendering an identity. Don't change the add-by-identity *input* forms.

- [ ] **Step 1:** For each call site, replace the inline truncate (`<code>{id.slice(0, 12)}…</code>`) with `<MemberLabel namespaceId={namespaceId} memberId={id} className="text-xs font-mono" />`. Where the site has the truncation pattern but is *intentionally* showing the pubkey (e.g. the confirm-dialog body saying "Remove `abc…`?"), keep it as the fallback but render through `<MemberLabel>` so a renamed member shows their name in the confirm-prompt too.
- [ ] **Step 2:** For self-row rendering (the caller's own identity in the namespace members list), pass `isSelf={memberId === selfIdentity}` for the "(you)" badge.
- [ ] **Step 3:** `permission-gating.test.tsx` and other component tests that mock identities — update assertions if they grep for the truncated pubkey text (now they may see the name first; safer to mock `useMemberDisplayName` to always return `null` in those tests so the fallback truncation still matches).
- [ ] **Step 4:** `tsc` / lint / `test` / `build` green.
- [ ] **Step 5: Commit** — `refactor(app): adopt <MemberLabel> across member-rendering sites`.

---

## Task 5: PR

- [ ] **Step 1:** `git push origin feat/member-display-names`.
- [ ] **Step 2:** `gh pr create --base refactor/frontend-battleships-alignment --title "feat(app): per-namespace member display names" --body "..."` — body covers: the design (core PR #2338 member metadata, self-edit always allowed), the hook + component split, the MyDisplayNamePanel UI surface, the call-site sweep, and the deferred items (admin override + name→identity autocomplete on add-forms + event-based cache invalidation). End with the Claude Code trailer.
- [ ] **Step 3:** Report: commits, gates, PR URL, deferred follow-ups.

## Self-review
- Spec coverage: self-edit display name ✓; everywhere a member is rendered shows the name ✓; truncated-pubkey fallback ✓; no cap change needed ✓ (core authz verified). Deferred: admin override / autocomplete / event-driven cache invalidation — flagged in the PR.
- No placeholders.
- No new core / WASM changes; pure frontend.
