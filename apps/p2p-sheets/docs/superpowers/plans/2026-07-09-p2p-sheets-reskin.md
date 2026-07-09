# p2p-sheets Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the open-workspace p2p-sheets UI (header, formula bar, grid, new status footer) to the landing-page dark "your node" aesthetic, with no spreadsheet behavior changes.

**Architecture:** Presentation-only. Retune the existing CSS-var dark palette and flip the default to dark; replace the single toolbar with a two-tier window-chrome header driven by real cursor presence; restyle grid/formula-bar accents from blue to green; add a pure status-footer component. Testable logic (theme default, presence math, status label strings) is extracted into pure helpers; component/CSS work is verified by `tsc` + the full suite staying green + `vite build` + local manual review.

**Tech Stack:** React 19, TypeScript, styled-components, vitest (node env — no component rendering), Vite.

## Global Constraints

- **Dark by default, light kept.** Default theme flips to `dark`; light theme + a working user toggle must remain. Mechanism: `app/src/theme.ts` (`getStoredTheme`/`useTheme`) + `app/src/index.css` tokens.
- **Real presence/status data only.** Live pill, avatars, and footer counts derive from `ss.cursors`, `ss.cells`, `ss.ready`, `ss.loaded`, and an in-flight-mutation flag. No faked animation or hard-coded counts. Zero peers is a valid shown state.
- **No behavior regressions.** All existing props, handlers, and `data-testid` / `aria-label` attributes on interactive controls are preserved. The full `app` vitest suite (currently 97 tests) stays green; `tsc` clean; `vite build` succeeds.
- **Accent** is `#a4ff11` (bright green, `--c-green`) in both themes; text-on-accent stays dark (`--c-on-accent: #0e140f`).
- **Scope:** only AppPage state 3 (open workspace) is reskinned. Workspace picker / "Opening…" gate, modals, `SheetTabs`, `ContextMenu`, `FunctionHelpPanel` internals are untouched beyond inheriting retuned tokens.
- **Commands (run from `app/`):** test `npx vitest run`, single file `npx vitest run <path>`, types `npx tsc --noEmit`, build `npx vite build`.

---

### Task 1: Theme foundation — dark default + retuned palette

**Files:**
- Modify: `app/src/index.css` (`:root` and `:root[data-theme='dark']` blocks)
- Modify: `app/src/theme.ts:38-44` (`getStoredTheme`), `app/src/theme.ts:17-33` (`C` object)
- Test: `app/src/theme.test.ts` (create)

**Interfaces:**
- Produces: `C.chrome` (= `'var(--c-chrome)'`) — the deepest chrome/footer surface token, consumed by Tasks 3 and 5. `getStoredTheme()` defaults to `'dark'`.

- [ ] **Step 1: Write the failing test**

Create `app/src/theme.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoredTheme } from './theme';

// getStoredTheme reads localStorage; in the node test env we stub it.
function stubLocalStorage(value: string | null) {
  vi.stubGlobal('localStorage', {
    getItem: () => value,
    setItem: () => {},
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('getStoredTheme', () => {
  it('defaults to dark when nothing is stored', () => {
    stubLocalStorage(null);
    expect(getStoredTheme()).toBe('dark');
  });

  it('defaults to dark when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(getStoredTheme()).toBe('dark');
  });

  it('honours a stored light preference', () => {
    stubLocalStorage('light');
    expect(getStoredTheme()).toBe('light');
  });

  it('honours a stored dark preference', () => {
    stubLocalStorage('dark');
    expect(getStoredTheme()).toBe('dark');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/theme.test.ts`
Expected: FAIL — "defaults to dark when nothing is stored" gets `'light'` (current default).

- [ ] **Step 3: Flip the default in `getStoredTheme`**

In `app/src/theme.ts`, replace the body of `getStoredTheme` (lines 38-44):

```ts
export function getStoredTheme(): ThemeMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/theme.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the `C.chrome` token**

In `app/src/theme.ts`, add to the `C` object (after the `line` entry, ~line 26):

```ts
  chrome: 'var(--c-chrome)',
```

- [ ] **Step 6: Retune the dark palette + add `--c-chrome` in `index.css`**

In `app/src/index.css`, in the `:root` (light) block add one line before the closing brace:

```css
  --c-chrome: #f5f8f1;
```

Replace the `:root[data-theme='dark']` block's values with (retuned toward the mockup's greenish-black; add `--c-chrome`):

```css
:root[data-theme='dark'] {
  --c-green: #a4ff11;
  --c-green-hover: #b4ff3d;
  --c-green-deep: #bdf76a;
  --c-green-ink: #cdf78a;
  --c-on-accent: #0e140f;
  --c-ink: #e8efe6;
  --c-paper: #0f1511;
  --c-paper2: #141a14;
  --c-line: rgba(164, 255, 17, 0.10);
  --c-muted: #8a978a;
  --c-muted-soft: #5f6b5f;
  --c-off: #3a414b;
  --c-disabled: #2a2f37;
  --c-danger: #ff6b6b;
  --c-chrome: #0b0f0c;
}
```

- [ ] **Step 7: Verify types, suite, build**

Run: `cd app && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: tsc clean; all tests pass (existing 97 + 4 new = 101); build succeeds.

- [ ] **Step 8: Commit**

```bash
cd app && git add src/theme.ts src/theme.test.ts src/index.css
git commit -m "feat(theme): dark by default + greenish-black palette retune"
```

---

### Task 2: Presence & status helpers (pure)

**Files:**
- Create: `app/src/spreadsheet/presence.ts`
- Test: `app/src/spreadsheet/presence.test.ts`

**Interfaces:**
- Consumes: `Cursor` type from `../api/spreadsheet/SpreadsheetClient` (fields used: `author: string`, `color: string`).
- Produces (consumed by Tasks 3 and 5):
  - `avatarLabel(author: string): string`
  - `interface Collaborator { author: string; color: string; label: string; isSelf: boolean }`
  - `distinctCollaborators(cursors: Cursor[], selfKey: string | null): Collaborator[]` — deduped by author, self ordered first
  - `peerCount(cursors: Cursor[], selfKey: string | null): number` — distinct authors excluding self
  - `syncLabel(synced: boolean): string`
  - `peersLabel(peers: number): string`
  - `cellsLabel(cells: number): string`

- [ ] **Step 1: Write the failing test**

Create `app/src/spreadsheet/presence.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Cursor } from '../api/spreadsheet/SpreadsheetClient';
import {
  avatarLabel,
  distinctCollaborators,
  peerCount,
  syncLabel,
  peersLabel,
  cellsLabel,
} from './presence';

const cur = (author: string, color: string): Cursor => ({
  id: `${author}-1`,
  author,
  sheet_id: 's1',
  row: 0,
  col: 0,
  color,
  updated_at: 0,
});

describe('avatarLabel', () => {
  it('takes the first two chars, uppercased', () => {
    expect(avatarLabel('abcdef')).toBe('AB');
  });
  it('handles a one-char author', () => {
    expect(avatarLabel('x')).toBe('X');
  });
  it('handles an empty author', () => {
    expect(avatarLabel('')).toBe('?');
  });
});

describe('distinctCollaborators', () => {
  it('dedupes by author and marks/sorts self first', () => {
    const cursors = [cur('bob', '#f00'), cur('me', '#0f0'), cur('bob', '#f00')];
    const result = distinctCollaborators(cursors, 'me');
    expect(result).toEqual([
      { author: 'me', color: '#0f0', label: 'ME', isSelf: true },
      { author: 'bob', color: '#f00', label: 'BO', isSelf: false },
    ]);
  });
  it('returns only peers when self is not present in cursors', () => {
    const result = distinctCollaborators([cur('bob', '#f00')], 'me');
    expect(result).toEqual([
      { author: 'bob', color: '#f00', label: 'BO', isSelf: false },
    ]);
  });
});

describe('peerCount', () => {
  it('counts distinct authors excluding self', () => {
    const cursors = [cur('me', '#0f0'), cur('bob', '#f00'), cur('amy', '#00f'), cur('bob', '#f00')];
    expect(peerCount(cursors, 'me')).toBe(2);
  });
  it('is zero when only self is present', () => {
    expect(peerCount([cur('me', '#0f0')], 'me')).toBe(0);
  });
});

describe('status labels', () => {
  it('syncLabel', () => {
    expect(syncLabel(true)).toBe('Synced');
    expect(syncLabel(false)).toBe('Syncing…');
  });
  it('peersLabel singular/plural', () => {
    expect(peersLabel(0)).toBe('0 peers');
    expect(peersLabel(1)).toBe('1 peer');
    expect(peersLabel(3)).toBe('3 peers');
  });
  it('cellsLabel singular/plural', () => {
    expect(cellsLabel(1)).toBe('1 cell');
    expect(cellsLabel(12)).toBe('12 cells');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/spreadsheet/presence.test.ts`
Expected: FAIL — module `./presence` not found.

- [ ] **Step 3: Write minimal implementation**

Create `app/src/spreadsheet/presence.ts`:

```ts
import type { Cursor } from '../api/spreadsheet/SpreadsheetClient';

/** 1–2 char uppercase avatar label from an opaque author key. */
export function avatarLabel(author: string): string {
  return author.slice(0, 2).toUpperCase() || '?';
}

export interface Collaborator {
  author: string;
  color: string;
  label: string;
  isSelf: boolean;
}

/** Distinct authors from live cursors, self ordered first and marked. */
export function distinctCollaborators(
  cursors: Cursor[],
  selfKey: string | null,
): Collaborator[] {
  const seen = new Map<string, Collaborator>();
  for (const c of cursors) {
    if (seen.has(c.author)) continue;
    seen.set(c.author, {
      author: c.author,
      color: c.color,
      label: avatarLabel(c.author),
      isSelf: c.author === selfKey,
    });
  }
  return [...seen.values()].sort(
    (a, b) => Number(b.isSelf) - Number(a.isSelf),
  );
}

/** Count of distinct authors excluding the local user. */
export function peerCount(cursors: Cursor[], selfKey: string | null): number {
  const authors = new Set<string>();
  for (const c of cursors) if (c.author !== selfKey) authors.add(c.author);
  return authors.size;
}

export function syncLabel(synced: boolean): string {
  return synced ? 'Synced' : 'Syncing…';
}

export function peersLabel(peers: number): string {
  return `${peers} ${peers === 1 ? 'peer' : 'peers'}`;
}

export function cellsLabel(cells: number): string {
  return `${cells} ${cells === 1 ? 'cell' : 'cells'}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/spreadsheet/presence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/spreadsheet/presence.ts src/spreadsheet/presence.test.ts
git commit -m "feat(presence): pure collaborator + status-label helpers"
```

---

### Task 3: StatusBar footer component

**Files:**
- Create: `app/src/components/StatusBar.tsx`

**Interfaces:**
- Consumes: `syncLabel`, `peersLabel`, `cellsLabel` from `../spreadsheet/presence`; `C` from `../theme`.
- Produces: `interface StatusBarProps { synced: boolean; peers: number; cells: number }` and `export default function StatusBar` — rendered by Task 5.

Note: the test env cannot render React components, so this task has no unit test; its logic lives in the Task-2 helpers (already tested). Verify by `tsc` + build + manual.

- [ ] **Step 1: Write the component**

Create `app/src/components/StatusBar.tsx`:

```tsx
/**
 * StatusBar — thin sync/presence footer below the sheet tabs.
 * Layout:  ● Synced · N peers · M cells
 * Pure presentation; all values are derived by AppPage from live hook state.
 */
import styled from 'styled-components';
import { C } from '../theme';
import { syncLabel, peersLabel, cellsLabel } from '../spreadsheet/presence';

interface StatusBarProps {
  synced: boolean;
  peers: number;
  cells: number;
}

export default function StatusBar({ synced, peers, cells }: StatusBarProps) {
  return (
    <Bar role="status" aria-live="polite">
      <Dot $synced={synced} aria-hidden="true" />
      <span>{syncLabel(synced)}</span>
      <Sep aria-hidden="true">·</Sep>
      <span>{peersLabel(peers)}</span>
      <Sep aria-hidden="true">·</Sep>
      <span>{cellsLabel(cells)}</span>
    </Bar>
  );
}

const Bar = styled.footer`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  flex-shrink: 0;
  padding: 0 14px;
  background: ${C.chrome};
  border-top: 1px solid ${C.line};
  font-size: 11.5px;
  color: ${C.muted};
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
`;

const Dot = styled.span<{ $synced: boolean }>`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${(p) => (p.$synced ? C.green : C.muted)};
  box-shadow: ${(p) => (p.$synced ? `0 0 6px ${C.green}` : 'none')};
`;

const Sep = styled.span`
  color: ${C.off};
`;
```

- [ ] **Step 2: Verify types + build**

Run: `cd app && npx tsc --noEmit && npx vite build`
Expected: tsc clean; build succeeds. (Component is not yet rendered anywhere — that happens in Task 5.)

- [ ] **Step 3: Commit**

```bash
cd app && git add src/components/StatusBar.tsx
git commit -m "feat(status): add StatusBar sync/presence footer component"
```

---

### Task 4: Expose an in-flight-mutation flag from useSpreadsheet

**Files:**
- Modify: `app/src/hooks/useSpreadsheet.ts:68-96` (interface), `:125-139` (enqueue), and the return object (~`:285`)

**Interfaces:**
- Produces: `mutating: boolean` on `UseSpreadsheetReturn` — true while ≥1 mutation is in flight through the serialization queue. Consumed by Task 5 to compute footer `synced`.

Note: hooks can't be render-tested in this env; verify by `tsc` + suite green + build.

- [ ] **Step 1: Add `mutating` to the return interface**

In `app/src/hooks/useSpreadsheet.ts`, in `UseSpreadsheetReturn` (after `loaded` at line 75-76):

```ts
  /** True while ≥1 state-changing mutation is in flight (serialization queue non-empty). */
  mutating: boolean;
```

- [ ] **Step 2: Track pending count in `enqueue`**

Add a state counter next to the other `useState` declarations (after `loaded`, ~line 113):

```ts
  const [pendingMutations, setPendingMutations] = useState(0);
```

Replace the `enqueue` callback (lines 132-139) with a counting version:

```ts
  const enqueue = useCallback(<T,>(op: () => Promise<T>): Promise<T> => {
    setPendingMutations((n) => n + 1);
    const next = mutationQueue.current.then(op, op);
    mutationQueue.current = next.then(
      () => undefined,
      () => undefined,
    );
    next.then(
      () => setPendingMutations((n) => n - 1),
      () => setPendingMutations((n) => n - 1),
    );
    return next;
  }, []);
```

- [ ] **Step 3: Return the flag**

In the returned object (~line 285, alongside `loaded`), add:

```ts
    mutating: pendingMutations > 0,
```

- [ ] **Step 4: Verify types, suite, build**

Run: `cd app && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/hooks/useSpreadsheet.ts
git commit -m "feat(spreadsheet): expose in-flight mutation flag for sync status"
```

---

### Task 5: Two-tier header, theme toggle, collaborator bar & wired StatusBar

**Files:**
- Modify: `app/src/pages/app/AppPage.tsx` — imports, the state-3 render block (`:746-929`), and the styled-components section (`:946-1052`, replacing `Toolbar`/`Brand`/`AppName`/`ToolbarActions` and adding new ones).

**Interfaces:**
- Consumes: `distinctCollaborators`, `peerCount` from `../../spreadsheet/presence`; `syncLabel`/`peersLabel`/`cellsLabel` indirectly via `StatusBar`; `useTheme`, `MoonIcon` from `../../theme`; `StatusBar` from `../../components/StatusBar`; `ss.mutating` from Task 4.
- Produces: nothing downstream (top-level page).

Note: integration task — no unit test (node env can't render). Verify by `tsc` + full suite green + build + local manual review.

- [ ] **Step 1: Add imports**

At the top of `app/src/pages/app/AppPage.tsx`, extend the theme import and add two imports:

```ts
import { C, useTheme, MoonIcon } from '../../theme';
```
```ts
import StatusBar from '../../components/StatusBar';
import { distinctCollaborators, peerCount } from '../../spreadsheet/presence';
```

- [ ] **Step 2: Add theme + derived presence state in the component body**

Immediately after `const ss = useSpreadsheet({ ... });` (~line 51), add:

```ts
  const { theme, toggle: toggleTheme } = useTheme();
```

After the `activeWorkspaceName` computation (~line 743-744), add:

```ts
  const collaborators = distinctCollaborators(ss.cursors, ws.executorPublicKey);
  const peers = peerCount(ss.cursors, ws.executorPublicKey);
  const connected = ss.ready && ss.loaded;
  const synced = ss.loaded && !ss.mutating;
```

- [ ] **Step 3: Replace the `<Toolbar>…</Toolbar>` block with the two-tier header**

Replace the entire `<Toolbar>` element (lines 749-825) with:

```tsx
      {/* ── Window chrome: title bar + collaborator bar ─────────────── */}
      <TitleBar>
        <Lights aria-hidden="true"><i /><i /><i /></Lights>
        <BackBtn
          onClick={async () => { if (isDirty) await commitCellRef.current?.(); ws.leaveWorkspace(); }}
          title="Back to workspaces"
          aria-label="Back to workspaces"
        >
          ←
        </BackBtn>
        <GridIcon aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
        </GridIcon>
        <TitleName>{activeWorkspaceName}</TitleName>
        <NodeTag>· your node</NodeTag>
        <LivePill $on={connected} title={connected ? 'Live' : 'Offline'}>
          <span aria-hidden="true">●</span>{connected ? 'live' : 'offline'}
        </LivePill>
      </TitleBar>

      <CollabBar>
        <Avatars aria-label={`${collaborators.length} collaborators`}>
          {collaborators.map((c) => (
            <Avatar
              key={c.author}
              style={{ background: c.color }}
              $self={c.isSelf}
              title={c.isSelf ? 'You' : c.author}
            >
              {c.label}
            </Avatar>
          ))}
        </Avatars>
        <CollabCount>
          {collaborators.length} collaborator{collaborators.length === 1 ? '' : 's'}
        </CollabCount>

        <ActionsSpacer />

        <PrimaryAction onClick={() => setShowInvite(true)} aria-label="Invite collaborators">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
          </svg>
          <span>Invite</span>
        </PrimaryAction>

        <ToolBtn onClick={() => setShowJoin(true)} aria-label="Join workspace">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
          </svg>
          <span>Join</span>
        </ToolBtn>

        <ToolBtn
          data-testid="action-export_all"
          onClick={handleDownload}
          title="Download as CSV"
          aria-label="Download spreadsheet as CSV"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>Download</span>
        </ToolBtn>

        <ToolBtn onClick={() => setShowHelp(true)} title="Function reference" aria-label="Open function reference">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>Functions</span>
        </ToolBtn>

        <IconBtn onClick={toggleTheme} title="Toggle theme" aria-label="Toggle light/dark theme">
          <MoonIcon filled={theme === 'dark'} size={16} />
        </IconBtn>

        <SignOutBtn onClick={logout} aria-label="Sign out">Sign out</SignOutBtn>
      </CollabBar>
```

- [ ] **Step 4: Render StatusBar after SheetTabs**

Immediately after the `</SheetTabs>` element closes (after line 899, before the Overlays comment), add:

```tsx
      <StatusBar synced={synced} peers={peers} cells={ss.cells.length} />
```

- [ ] **Step 5: Replace the toolbar styled-components**

In the styled-components section, DELETE the `Toolbar` (946-956), `Brand` (958-963), `AppName` (988-994), and `ToolbarActions` (996-1000) definitions, and ADD the following (keep `BackBtn`, `GridIcon`, `ToolBtn`, `Divider`, `SignOutBtn` — `Divider` may now be unused, remove it if so):

```ts
const TitleBar = styled.header`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  flex-shrink: 0;
  padding: 0 12px;
  background: ${C.chrome};
  border-bottom: 1px solid ${C.line};
`;

const Lights = styled.div`
  display: flex;
  gap: 6px;
  margin-right: 4px;
  i {
    width: 10px; height: 10px; border-radius: 50%;
    display: block;
  }
  i:nth-child(1) { background: #ff5f56; }
  i:nth-child(2) { background: #ffbd2e; }
  i:nth-child(3) { background: ${C.green}; }
`;

const TitleName = styled.span`
  font-size: 13px;
  font-weight: 700;
  color: ${C.ink};
  letter-spacing: -0.2px;
  white-space: nowrap;
`;

const NodeTag = styled.span`
  font-size: 12px;
  color: ${C.muted};
  white-space: nowrap;
`;

const LivePill = styled.span<{ $on: boolean }>`
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: ${(p) => (p.$on ? C.green : C.muted)};
  span { font-size: 8px; }
`;

const CollabBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  flex-shrink: 0;
  padding: 0 12px;
  background: ${C.paper};
  border-bottom: 1px solid ${C.line};
`;

const Avatars = styled.div`
  display: flex;
  align-items: center;
  padding-left: 6px;
`;

const Avatar = styled.span<{ $self: boolean }>`
  width: 24px; height: 24px;
  margin-left: -6px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  font-weight: 700;
  color: ${C.onAccent};
  border: 2px solid ${C.paper};
  box-shadow: ${(p) => (p.$self ? `0 0 0 2px ${C.green}` : 'none')};
`;

const CollabCount = styled.span`
  font-size: 12px;
  color: ${C.muted};
  white-space: nowrap;
  @media (max-width: 700px) { display: none; }
`;

const ActionsSpacer = styled.div`
  margin-left: auto;
`;

const PrimaryAction = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 600;
  color: ${C.onAccent};
  background: ${C.green};
  border: 1px solid ${C.greenHover};
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.14s, transform 0.12s;
  svg { flex-shrink: 0; }
  &:hover { background: ${C.greenHover}; transform: translateY(-1px); }
  @media (max-width: 700px) { span { display: none; } }
`;

const IconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px; height: 32px;
  color: ${C.muted};
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.14s, color 0.14s;
  &:hover { background: ${C.paper2}; color: ${C.ink}; }
`;
```

- [ ] **Step 6: Verify types, suite, build**

Run: `cd app && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: tsc clean (no unused-symbol errors — if `Divider` is now unused, it was removed in Step 5); all tests pass; build succeeds.

- [ ] **Step 7: Commit**

```bash
cd app && git add src/pages/app/AppPage.tsx
git commit -m "feat(app): two-tier window-chrome header, collaborator bar, theme toggle, status footer"
```

---

### Task 6: Grid — blue accent → green

**Files:**
- Modify: `app/src/components/SpreadsheetGrid.tsx:463` (`ACCENT`), `:501`, `:507`, `:512`, `:519`, `:525`, `:530`, `:554-556`, `:571`

**Interfaces:** none (styling only; no prop/behavior change).

Note: no unit test (styling). Verify by `tsc` + suite green + build + manual.

- [ ] **Step 1: Retarget the accent constant**

In `app/src/components/SpreadsheetGrid.tsx` line 463, replace:

```ts
const ACCENT = '#3B82F6'; // blue accent for selection (spec accent color)
```
with:
```ts
const ACCENT = C.green; // green selection accent (matches landing mockup)
const ACCENT_TEXT = C.greenDeep; // readable green for selected header labels
```

- [ ] **Step 2: Swap the blue tints to green**

In the same file, make these exact replacements (all are the blue `rgba(59,130,246,…)` tints and the selected-header text color):

- `ColTh` (line 501): `p.$selected ? 'rgba(59,130,246,0.1)'` → `p.$selected ? 'rgba(164,255,17,0.12)'`
- `ColTh` (line 507): `p.$selected ? ACCENT : C.muted` → `p.$selected ? ACCENT_TEXT : C.muted`
- `ColTh` (line 512): `&:hover { background: rgba(59,130,246,0.14); }` → `&:hover { background: rgba(164,255,17,0.10); }`
- `RowTh` (line 519): `p.$selected ? 'rgba(59,130,246,0.1)'` → `p.$selected ? 'rgba(164,255,17,0.12)'`
- `RowTh` (line 525): `p.$selected ? ACCENT : C.muted` → `p.$selected ? ACCENT_TEXT : C.muted`
- `RowTh` (line 530): `&:hover { background: rgba(59,130,246,0.14); }` → `&:hover { background: rgba(164,255,17,0.10); }`
- `DataCell` selected block (line 556): `background: rgba(59, 130, 246, 0.04);` → `background: rgba(164, 255, 17, 0.06);`
- `DataCell` in-range block (line 571): `background: rgba(59, 130, 246, 0.14);` → `background: rgba(164, 255, 17, 0.12);`

Leave the `$selected` outline (line 554, `outline: 2px solid ${ACCENT}`) as-is — it now resolves to green via the constant.

- [ ] **Step 3: Verify types, suite, build**

Run: `cd app && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/components/SpreadsheetGrid.tsx
git commit -m "style(grid): green selection accent to match reskin"
```

---

### Task 7: FormulaBar — green focus tint

**Files:**
- Modify: `app/src/components/FormulaBar.tsx:272-274` (`Input` focus rule)

**Interfaces:** none (styling only).

Note: no unit test (styling). Verify by `tsc` + suite green + build + manual.

- [ ] **Step 1: Swap the blue focus tint to green**

In `app/src/components/FormulaBar.tsx`, replace the `Input` `&:focus` rule (lines 272-274):

```ts
  &:focus {
    background: rgba(59, 130, 246, 0.04);
  }
```
with:
```ts
  &:focus {
    background: rgba(164, 255, 17, 0.06);
  }
```

- [ ] **Step 2: Verify types, suite, build**

Run: `cd app && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 3: Commit**

```bash
cd app && git add src/components/FormulaBar.tsx
git commit -m "style(formula-bar): green focus tint to match reskin"
```

---

## Self-Review

**Spec coverage:**
- Dark default + light kept → Task 1 (default flip) + Task 5 (toggle). ✓
- Dark palette retune + `--c-chrome` → Task 1. ✓
- Two-tier header (traffic-lights, back, logo, workspace name, `· your node`, live pill / avatars, count, actions, theme toggle, sign out) → Task 5. ✓
- Formula bar dark restyle → inherited via tokens (Task 1) + green focus (Task 7). ✓
- Grid dark restyle + green selection → tokens (Task 1) + green accent (Task 6). ✓
- Status footer (Synced/Syncing, peers excl. self, cells) → Task 3 (component) + Task 2 (labels) + Task 4 (mutating flag) + Task 5 (wiring). ✓
- Real presence data (avatars from cursors, self marked/first; peers exclude self) → Task 2 + Task 5. ✓
- Preserve `data-testid`/`aria-label` → Task 5 keeps `action-export_all` and all aria labels. ✓
- Non-goals untouched (picker, modals, tabs) → no task modifies them. ✓

**Placeholder scan:** none — every code step has complete code and exact commands.

**Type consistency:** `Collaborator`/`distinctCollaborators`/`peerCount`/`avatarLabel`/`syncLabel`/`peersLabel`/`cellsLabel` (Task 2) match their uses in Tasks 3 & 5. `mutating` (Task 4) matches its read in Task 5 (`ss.mutating`). `C.chrome` (Task 1) matches its use in Tasks 3 & 5. `ACCENT`/`ACCENT_TEXT` (Task 6) consistent within the file.

**Verified assumptions:** `Cursor` has `author`/`color` (SpreadsheetClient.ts:31-39); `ws.executorPublicKey` exists (AppPage:50); `index.tsx` applies theme at startup so the default flip suffices; grid `ACCENT` was hard-coded blue at line 463.
