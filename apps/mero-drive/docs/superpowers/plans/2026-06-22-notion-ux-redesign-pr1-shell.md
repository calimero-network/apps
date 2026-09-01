# Notion-Style Workspace UX Redesign — PR1 (Shell Restructure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the workspace into a Notion-like shell — a unified resizable/collapsible folders+docs sidebar with an inline document editor — plus a required display-name gate, a light/dark theme toggle, and a consolidated folder `⋯` menu with an Info panel.

**Architecture:** Frontend-only. The top bar + sidebar become a persistent shell; the document editor renders inline in the main pane instead of replacing the viewport. The sidebar grows lazy-loaded document leaves under each folder. All data hooks (`useDriveWorkspace`, `useDocs`, `useFolderPermissions`, `useMemberDisplayName`, `useSetSubgroupVisibility`) are consumed unchanged; `DocumentEditor`'s save orchestration is untouched.

**Tech Stack:** React 19, TypeScript, Tailwind (shadcn-style tokens), Radix UI primitives, Tiptap, Vitest + Testing Library (jsdom), Playwright (e2e via merobox).

**Spec:** `docs/superpowers/specs/2026-06-22-notion-ux-redesign-design.md` (PR1 = decisions 1–6, 10). The editor UX overhaul (slash/bubble menus, in-body title, papercut fixes — decisions 7/8/9) is **PR2** and out of scope here.

## Global Constraints

- **Working directory for all commands:** `app/` (the React app). Paths below are relative to `app/`.
- **Branch:** `feat/notion-ux-redesign` (already created).
- **Test runner:** Vitest. Config in `vite.config.js` → `test: { environment: 'jsdom', globals: true, include: ['src/**/*.{test,spec}.{ts,tsx}'] }`. Path alias `@` → `app/src`.
- **Test convention (REQUIRED):** Do **not** use `@testing-library/jest-dom` matchers (`.toBeInTheDocument()`, `.toHaveClass()`, etc.). There is no global setup file. Use plain Vitest/chai assertions: `expect(el).toBeTruthy()`, `expect(el.textContent).toContain('x')`, `expect(el.classList.contains('x')).toBe(true)`. Mock hooks with `vi.mock`.
- **Commands:** single test → `pnpm exec vitest run <path>`; full unit suite → `pnpm test`; lint (zero warnings) → `pnpm lint`; production build → `pnpm build`.
- **Lint gate:** `pnpm lint` runs `eslint … --max-warnings 0`. Keep imports used and hook deps correct.
- **Commit messages:** end every commit message body with the trailer line:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **localStorage keys (new):** `mero-theme` (`"dark"` | `"light"`), `mero-sidebar-width` (number), `mero-sidebar-collapsed` (boolean). `useLocalStorage<T>(key, initial)` JSON-serializes values.
- **No new runtime dependencies** are required for PR1.

## File Structure

**New files**
- `src/components/theme/ThemeProvider.tsx` — theme context + `useTheme` hook (owns `.dark` class + persistence).
- `src/components/theme/ThemeToggle.tsx` — sun/moon button.
- `src/components/theme/__tests__/ThemeProvider.test.tsx`
- `src/components/folders/FolderDocLeaves.tsx` — lazy doc leaves for one expanded folder.
- `src/components/folders/__tests__/FolderDocLeaves.test.tsx`
- `src/components/folders/FolderInfoPanel.tsx` — modal: folder name + visibility toggle + members (embeds `FolderSharingPanel`).
- `src/components/folders/__tests__/FolderInfoPanel.test.tsx`
- `src/components/workspace/WorkspaceSidebar.tsx` — resizable container wrapping the tree.
- `src/components/workspace/__tests__/WorkspaceSidebar.test.tsx`
- `src/components/workspace/DisplayNameGate.tsx` — blocking overlay when self-name is null.
- `src/components/workspace/__tests__/DisplayNameGate.test.tsx`
- `src/components/workspace/FolderEmptyState.tsx` — "no doc open" pane content with a New-document CTA.

**Modified files**
- `index.html` — no-FOUC theme bootstrap script.
- `src/index.css` — remove forced `html { @apply dark }`; tokenized sync-indicator color.
- `src/App.tsx` — wrap tree in `<ThemeProvider>`.
- `src/components/folders/FolderTree.tsx` — own `expanded` set; accept `selectedDocId` + `onOpenDoc`.
- `src/components/folders/FolderTreeItem.tsx` — controlled expand; render doc leaves; per-folder `+ New doc`.
- `src/components/folders/FolderVisibilityToggle.tsx` — render a Button (was a DropdownMenuItem).
- `src/components/folders/FolderContextMenu.tsx` — add `Info` item; remove inline visibility item; always render trigger.
- `src/components/editor/EditorShell.tsx` — `h-screen` → `h-full` (fills the pane).
- `src/components/editor/EditorHeader.tsx` — drop the redundant logo.
- `src/components/workspace/WorkspaceLayout.tsx` — persistent shell, pane switch, sidebar wrapper, top-bar `☰`/theme, mount gate, inline editor.

**Deleted (Task 6, after parity)**
- `src/components/docs/DocumentList.tsx`

---

## Task 1: Theme system (provider, toggle, no-FOUC bootstrap, un-force dark)

**Files:**
- Create: `src/components/theme/ThemeProvider.tsx`, `src/components/theme/ThemeToggle.tsx`
- Test: `src/components/theme/__tests__/ThemeProvider.test.tsx`
- Modify: `index.html`, `src/index.css`, `src/App.tsx`

**Interfaces:**
- Produces: `ThemeProvider({children})`; `useTheme(): { theme: 'light'|'dark'; setTheme(t): void; toggle(): void }`; `ThemeToggle()` (no props).
- Consumes: `useLocalStorage<T>(key, initial): [T, (v:T)=>void]` from `@/hooks/useLocalStorage`.

- [ ] **Step 1: Write the failing test**

Create `src/components/theme/__tests__/ThemeProvider.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../ThemeProvider';

function Probe() {
  const { theme, toggle } = useTheme();
  return <button onClick={toggle}>theme:{theme}</button>;
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('defaults to dark and applies the dark class', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByRole('button').textContent).toBe('theme:dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('toggles to light, removes the class, and persists', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('theme:light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('mero-theme')).toBe('"light"');
  });

  it('reads a persisted theme on mount', () => {
    localStorage.setItem('mero-theme', '"light"');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByRole('button').textContent).toBe('theme:light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/components/theme/__tests__/ThemeProvider.test.tsx`
Expected: FAIL — cannot resolve `../ThemeProvider`.

- [ ] **Step 3: Implement `ThemeProvider.tsx`**

Create `src/components/theme/ThemeProvider.tsx`:

```tsx
// Light/dark theme context. Owns the `.dark` class on <html> and
// persists the choice to localStorage. Dark is the default; the
// no-FOUC bootstrap in index.html applies the class before React
// mounts so there is no light-flash on first paint.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
} from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useLocalStorage<Theme>('mero-theme', 'dark');

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [theme]);

  const toggle = useCallback(
    () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/components/theme/__tests__/ThemeProvider.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `ThemeToggle.tsx`**

Create `src/components/theme/ThemeToggle.tsx`:

```tsx
// Top-bar sun/moon button. Shows the icon for the mode you'd switch
// TO (sun while dark, moon while light), matching the aria-label.

import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from './ThemeProvider';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={isDark}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
```

- [ ] **Step 6: Add the no-FOUC bootstrap to `index.html`**

In `index.html`, inside `<head>` (immediately after the `<title>` line), add:

```html
    <script>
      // Apply the persisted theme before React mounts to avoid a
      // light-mode flash. Default to dark unless explicitly 'light'.
      (function () {
        try {
          var t = JSON.parse(localStorage.getItem('mero-theme'));
          if (t !== 'light') document.documentElement.classList.add('dark');
        } catch (e) {
          document.documentElement.classList.add('dark');
        }
      })();
    </script>
```

- [ ] **Step 7: Un-force dark in `src/index.css`**

Find and **delete** this rule (in the first `@layer base` block):

```css
  html {
    @apply dark;
  }
```

Leave every other rule in that block (`* { @apply border-border; }`, `body { … }`, headings) unchanged.

- [ ] **Step 8: Wrap the app in `ThemeProvider` (`src/App.tsx`)**

Add the import after the existing provider imports:

```tsx
import { ThemeProvider } from '@/components/theme/ThemeProvider';
```

Wrap the entire returned tree so `ThemeProvider` is the outermost element. Change the `return (` body so it begins with `<ThemeProvider>` and ends with `</ThemeProvider>`, with `<MeroProvider …>` … `</MeroProvider>` nested inside:

```tsx
  return (
    <ThemeProvider>
      <MeroProvider
        mode={AppMode.MultiContext}
        packageName={packageName}
        registryUrl={registryUrl}
      >
        {/* …existing ToastProvider/TooltipProvider/ConfirmProvider/BrowserRouter tree, unchanged… */}
      </MeroProvider>
    </ThemeProvider>
  );
```

- [ ] **Step 9: Lint + full suite**

Run: `pnpm lint && pnpm test`
Expected: lint clean; all tests pass (new theme tests included).

- [ ] **Step 10: Commit**

```bash
git add src/components/theme index.html src/index.css src/App.tsx
git commit -m "$(cat <<'EOF'
feat(theme): light/dark toggle with no-FOUC bootstrap

ThemeProvider owns the .dark class + persists to localStorage; remove
the hard-coded forced-dark rule so light tokens activate. Adds a sun/
moon ThemeToggle (wired into the top bar in a later task).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Unified sidebar — lazy doc leaves + cross-folder open

Adds documents under each folder in the tree (lazy-loaded on expand) and a cross-folder doc-open path. The existing full-screen editor still opens on selection (it becomes inline in Task 6); this task only makes docs reachable from the sidebar and fixes doc-selection state to survive a folder change.

**Files:**
- Create: `src/components/folders/FolderDocLeaves.tsx`
- Test: `src/components/folders/__tests__/FolderDocLeaves.test.tsx`
- Modify: `src/components/folders/FolderTree.tsx`, `src/components/folders/FolderTreeItem.tsx`, `src/components/workspace/WorkspaceLayout.tsx`

**Interfaces:**
- Consumes: `useDocs(folderId)` → `{ list: {id:string; title:string}[]; create({title}): Promise<string>; contextId: string|null; contextResolving: boolean; loading: boolean; error: Error|null }`; `useFolderPermissions(nsId, folderId).canEditDocs: boolean`; `useDriveWorkspace().{ setSelectedFolder(id|null), selectedFolderId, namespaceId }`.
- Produces:
  - `FolderDocLeaves({ folderId, depth, selectedDocId, onOpenDoc })`.
  - `FolderTree({ selectedDocId, onOpenDoc })` (was prop-less).
  - `onOpenDoc: (folderId: string, docId: string) => void` — WorkspaceLayout's combined folder+doc selector.

- [ ] **Step 1: Write the failing test for `FolderDocLeaves`**

Create `src/components/folders/__tests__/FolderDocLeaves.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FolderDocLeaves } from '../FolderDocLeaves';

const useDocsMock = vi.fn();
vi.mock('@/hooks/useDocs', () => ({ useDocs: (id: string) => useDocsMock(id) }));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ namespaceId: 'ns1' }),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({ canEditDocs: true }),
}));

const baseDocs = {
  list: [],
  create: vi.fn(),
  contextId: 'ctx1',
  contextResolving: false,
  loading: false,
  error: null as Error | null,
};

describe('FolderDocLeaves', () => {
  beforeEach(() => useDocsMock.mockReset());

  it('lists docs and calls onOpenDoc with folderId + docId on click', () => {
    useDocsMock.mockReturnValue({
      ...baseDocs,
      list: [{ id: 'd1', title: 'Brief' }, { id: 'd2', title: '' }],
    });
    const onOpenDoc = vi.fn();
    render(
      <ul>
        <FolderDocLeaves
          folderId="f1"
          depth={1}
          selectedDocId={null}
          onOpenDoc={onOpenDoc}
        />
      </ul>,
    );
    expect(screen.getByText('Brief')).toBeTruthy();
    // empty title falls back to 'Untitled'
    expect(screen.getByText('Untitled')).toBeTruthy();
    fireEvent.click(screen.getByText('Brief'));
    expect(onOpenDoc).toHaveBeenCalledWith('f1', 'd1');
  });

  it('shows a syncing hint while the context resolves', () => {
    useDocsMock.mockReturnValue({
      ...baseDocs,
      contextId: null,
      contextResolving: true,
    });
    const { container } = render(
      <ul>
        <FolderDocLeaves folderId="f1" depth={1} selectedDocId={null} onOpenDoc={vi.fn()} />
      </ul>,
    );
    expect(container.textContent).toContain('Syncing');
  });

  it('renders nothing when the folder has no docs', () => {
    useDocsMock.mockReturnValue({ ...baseDocs, list: [] });
    const { container } = render(
      <ul>
        <FolderDocLeaves folderId="f1" depth={1} selectedDocId={null} onOpenDoc={vi.fn()} />
      </ul>,
    );
    // no list items rendered
    expect(container.querySelectorAll('li').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/components/folders/__tests__/FolderDocLeaves.test.tsx`
Expected: FAIL — cannot resolve `../FolderDocLeaves`.

- [ ] **Step 3: Implement `FolderDocLeaves.tsx`**

Create `src/components/folders/FolderDocLeaves.tsx`:

```tsx
// Document leaves for ONE expanded folder. Mounted by FolderTreeItem
// only while its folder is expanded, so useDocs(folderId) — which
// resolves a per-folder Calimero context — fires lazily rather than
// for every folder in the tree on load. Collapsing the folder
// unmounts this and releases the subscription.

import React from 'react';
import { FileText } from 'lucide-react';
import { useDocs } from '@/hooks/useDocs';

interface Props {
  folderId: string;
  depth: number;
  selectedDocId: string | null;
  onOpenDoc: (folderId: string, docId: string) => void;
}

export function FolderDocLeaves({
  folderId,
  depth,
  selectedDocId,
  onOpenDoc,
}: Props) {
  const docs = useDocs(folderId);
  const padLeft = 8 + depth * 14;

  // Context not yet bound: a brief muted hint, never a red error —
  // folders sync from peers and the context lands a moment later.
  if (!docs.contextId) {
    if (docs.error) return null; // access-denied / no membership: silent
    if (docs.contextResolving) {
      return (
        <li
          className="px-2 py-1 text-xs text-muted-foreground"
          style={{ paddingLeft: padLeft }}
        >
          Syncing…
        </li>
      );
    }
    return null;
  }

  if (docs.error) return null;
  if (docs.loading && docs.list.length === 0) return null;

  return (
    <>
      {docs.list.map((d) => {
        const isSelected = d.id === selectedDocId;
        return (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onOpenDoc(folderId, d.id)}
              style={{ paddingLeft: padLeft }}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm ${
                isSelected
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-muted'
              }`}
            >
              <FileText
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="truncate">{d.title || 'Untitled'}</span>
            </button>
          </li>
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/components/folders/__tests__/FolderDocLeaves.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor `FolderTree.tsx` to own expand state + accept props**

In `src/components/folders/FolderTree.tsx`:

1. Add `useState`/`useCallback` to the React import:
```tsx
import React, { useCallback, useMemo, useState } from 'react';
```
2. Change the component signature and add expand state + props:
```tsx
interface FolderTreeProps {
  selectedDocId: string | null;
  onOpenDoc: (folderId: string, docId: string) => void;
}

export function FolderTree({ selectedDocId, onOpenDoc }: FolderTreeProps) {
  const {
    folders,
    loading,
    stage,
    error,
    selectedFolderId,
    setSelectedFolder,
    namespaceId,
  } = useDriveWorkspace();

  // Expansion is owned here (was per-row state) so it survives the
  // frequent useMemo recompute of `folders` on SSE refetch and so a
  // future "expand all" can live in one place. Default: nothing
  // forced open — the user expands what they want.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
```
3. In the `tree.roots.map(...)` render, pass the new props to each `FolderTreeItem`:
```tsx
            <FolderTreeItem
              key={n.id}
              node={n}
              byId={byId}
              depth={0}
              selectedId={selectedFolderId}
              onSelect={setSelectedFolder}
              expanded={expanded}
              onToggleExpanded={toggleExpanded}
              selectedDocId={selectedDocId}
              onOpenDoc={onOpenDoc}
            />
```

> Note: previously rows defaulted to expanded (`useState(true)`). Defaulting to collapsed is intentional — with docs now nested, auto-expanding every folder would fire `useDocs` for all of them at once.

- [ ] **Step 6: Refactor `FolderTreeItem.tsx` for controlled expand + doc leaves**

In `src/components/folders/FolderTreeItem.tsx`:

1. Add the import for the leaves component:
```tsx
import { FolderDocLeaves } from './FolderDocLeaves';
```
2. Extend `Props`:
```tsx
interface Props {
  node: TreeNode;
  byId: Map<string, MergedFolder>;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  selectedDocId: string | null;
  onOpenDoc: (folderId: string, docId: string) => void;
}
```
3. Replace the destructure + the local `expanded` state. Remove `const [expanded, setExpanded] = useState(true);`. Derive from props:
```tsx
export function FolderTreeItem({
  node,
  byId,
  depth,
  selectedId,
  onSelect,
  expanded,
  onToggleExpanded,
  selectedDocId,
  onOpenDoc,
}: Props) {
  const folder = byId.get(node.id);
  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
```
4. The expand/collapse chevron must show whenever the folder *might* contain docs or subfolders. Since docs are lazy, we don't know doc count up front — always show the chevron (a folder can always hold docs). Replace the `hasChildren ? (chevron button) : (spacer)` block so the chevron renders unconditionally and toggles via the prop:
```tsx
        <button
          type="button"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
          className="flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpanded(node.id);
          }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
```
(Remove the leaf-row `<span>` spacer branch entirely; the chevron is always present now.)

5. Replace the children render block at the bottom. Render doc leaves first, then subfolders, inside one `<ul>`, only when expanded:
```tsx
      {isExpanded && (
        <ul>
          <FolderDocLeaves
            folderId={node.id}
            depth={depth + 1}
            selectedDocId={selectedDocId}
            onOpenDoc={onOpenDoc}
          />
          {node.children.map((c) => (
            <FolderTreeItem
              key={c.id}
              node={c}
              byId={byId}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              expanded={expanded}
              onToggleExpanded={onToggleExpanded}
              selectedDocId={selectedDocId}
              onOpenDoc={onOpenDoc}
            />
          ))}
        </ul>
      )}
```
Keep `hasChildren` available if referenced elsewhere; otherwise remove the now-unused `const hasChildren` to satisfy lint. (It is no longer used after this change — delete the line.)

- [ ] **Step 7: Add `openDoc` + guarded reset to `WorkspaceLayout.tsx`**

In `src/components/workspace/WorkspaceLayout.tsx`:

1. Add `useCallback`/`useRef` to the React import:
```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
```
2. After the `selectedDocId` state declaration, add a ref tracking the open doc's folder and a combined opener:
```tsx
  // The folder the currently-open doc belongs to. Lets the reset
  // effect below distinguish "user clicked a different folder" (clear
  // the doc) from "user opened a doc in another folder" (keep it).
  const selectedDocFolderRef = useRef<string | null>(null);

  const openDoc = useCallback(
    (folderId: string, docId: string) => {
      selectedDocFolderRef.current = folderId;
      setSelectedFolder(folderId);
      setSelectedDocId(docId);
    },
    [setSelectedFolder],
  );
```
   Add `setSelectedFolder` to the `useDriveWorkspace()` destructure at the top of the component.
3. Replace the existing reset effect (the one that does `setSelectedDocId(null)` on `[selectedFolderId]`) with the guarded version:
```tsx
  // Clear the open doc when the active folder changes to a folder the
  // doc does NOT belong to — i.e. a folder-row click, remote delete,
  // or permission revoke. When openDoc set both folder + doc together
  // (cross-folder doc open), the ref matches the new folder and the
  // doc is preserved.
  useEffect(() => {
    if (selectedFolderId !== selectedDocFolderRef.current) {
      setSelectedDocId(null);
      selectedDocFolderRef.current = null;
    }
  }, [selectedFolderId]);
```
4. Update the `<FolderTree />` usage (inside the `<aside>`) to pass the new props:
```tsx
        <aside className="w-64 shrink-0 border-r border-border bg-muted/20">
          <FolderTree selectedDocId={selectedDocId} onOpenDoc={openDoc} />
        </aside>
```
5. Update the `DocumentList` `onOpen` call site so same-folder opens go through `openDoc`:
```tsx
                    <DocumentList
                      key={`list:${selectedFolder.id}`}
                      folderId={selectedFolder.id}
                      selectedDocId={selectedDocId}
                      onOpen={(docId) => openDoc(selectedFolder.id, docId)}
                    />
```

- [ ] **Step 8: Lint + build + full suite**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: clean lint; all tests pass; build succeeds.

- [ ] **Step 9: Manual smoke (optional but recommended)**

Use the `run` skill (or `pnpm dev`) to confirm: expanding a folder reveals its docs; clicking a doc in a *different* folder opens it (full-screen editor still, for now) and does not get cleared; collapsing hides docs.

- [ ] **Step 10: Commit**

```bash
git add src/components/folders/FolderDocLeaves.tsx \
        src/components/folders/__tests__/FolderDocLeaves.test.tsx \
        src/components/folders/FolderTree.tsx \
        src/components/folders/FolderTreeItem.tsx \
        src/components/workspace/WorkspaceLayout.tsx
git commit -m "$(cat <<'EOF'
feat(sidebar): nest lazy-loaded doc leaves under folders

Folders expand to reveal their documents (useDocs fires only on
expand). Adds a cross-folder openDoc selector with a guarded reset so
opening a doc in another folder survives the folder-change effect.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Resizable + collapsible sidebar, top-bar controls, tokenized sync dot

**Files:**
- Create: `src/components/workspace/WorkspaceSidebar.tsx`
- Test: `src/components/workspace/__tests__/WorkspaceSidebar.test.tsx`
- Modify: `src/components/workspace/WorkspaceLayout.tsx`, `src/index.css`

**Interfaces:**
- Produces: `WorkspaceSidebar({ width, minWidth?, maxWidth?, onWidthChange, children })` — a resizable left panel; `width:number`, `onWidthChange:(w:number)=>void`.
- Consumes: `useLocalStorage`; `ThemeToggle` from Task 1.

- [ ] **Step 1: Write the failing test**

Create `src/components/workspace/__tests__/WorkspaceSidebar.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceSidebar } from '../WorkspaceSidebar';

describe('WorkspaceSidebar', () => {
  it('renders children at the given width', () => {
    const { container } = render(
      <WorkspaceSidebar width={300} onWidthChange={vi.fn()}>
        <div>tree</div>
      </WorkspaceSidebar>,
    );
    expect(screen.getByText('tree')).toBeTruthy();
    const aside = container.querySelector('aside');
    expect(aside?.style.width).toBe('300px');
  });

  it('reports a clamped new width while dragging the handle', () => {
    const onWidthChange = vi.fn();
    render(
      <WorkspaceSidebar
        width={300}
        minWidth={200}
        maxWidth={480}
        onWidthChange={onWidthChange}
      >
        <div>tree</div>
      </WorkspaceSidebar>,
    );
    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, { clientX: 300 });
    // drag far right past max → clamps to 480
    fireEvent.pointerMove(window, { clientX: 900 });
    expect(onWidthChange).toHaveBeenLastCalledWith(480);
    // drag far left past min → clamps to 200
    fireEvent.pointerMove(window, { clientX: 0 });
    expect(onWidthChange).toHaveBeenLastCalledWith(200);
    fireEvent.pointerUp(window);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/components/workspace/__tests__/WorkspaceSidebar.test.tsx`
Expected: FAIL — cannot resolve `../WorkspaceSidebar`.

- [ ] **Step 3: Implement `WorkspaceSidebar.tsx`**

Create `src/components/workspace/WorkspaceSidebar.tsx`:

```tsx
// Resizable left panel. Width is controlled by the parent (persisted
// via useLocalStorage in WorkspaceLayout); this component owns only
// the drag interaction. Collapse is handled by the parent simply not
// rendering this component, so there is no collapsed state here.

import React, { useCallback, useEffect, useRef } from 'react';

interface Props {
  width: number;
  minWidth?: number;
  maxWidth?: number;
  onWidthChange: (w: number) => void;
  children: React.ReactNode;
}

export function WorkspaceSidebar({
  width,
  minWidth = 200,
  maxWidth = 480,
  onWidthChange,
  children,
}: Props) {
  const draggingRef = useRef(false);

  const clamp = useCallback(
    (w: number) => Math.min(maxWidth, Math.max(minWidth, w)),
    [minWidth, maxWidth],
  );

  // Window-level move/up listeners so the drag keeps tracking even if
  // the pointer leaves the 4px handle. Re-bound whenever clamp /
  // onWidthChange identity changes; cleaned up on unmount.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      onWidthChange(clamp(e.clientX));
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [clamp, onWidthChange]);

  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onWidthChange(clamp(width - 16));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onWidthChange(clamp(width + 16));
    }
  };

  return (
    <aside
      style={{ width: `${width}px` }}
      className="relative shrink-0 border-r border-border bg-muted/20"
    >
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        tabIndex={0}
        onKeyDown={onHandleKeyDown}
        onPointerDown={() => {
          draggingRef.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
      />
    </aside>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/components/workspace/__tests__/WorkspaceSidebar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire sidebar width/collapse + top-bar controls into `WorkspaceLayout.tsx`**

In `src/components/workspace/WorkspaceLayout.tsx`:

1. Add imports:
```tsx
import { PanelLeft } from 'lucide-react';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useLocalStorage } from '@/hooks/useLocalStorage';
```
2. Add persisted UI state near the other `useState`s:
```tsx
  const [sidebarWidth, setSidebarWidth] = useLocalStorage<number>(
    'mero-sidebar-width',
    256,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage<boolean>(
    'mero-sidebar-collapsed',
    false,
  );
```
3. In the top-bar header, add the collapse button as the first item in the left `<div className="flex items-center gap-4">` (before `LogoWithText`):
```tsx
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            aria-pressed={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
```
4. In the top-bar right-side actions `<div className="flex items-center gap-2">`, add `<ThemeToggle />` immediately before the `{namespaceId && (` Settings button:
```tsx
          <ThemeToggle />
```
5. Replace the fixed `<aside>` with a conditional `WorkspaceSidebar`:
```tsx
        {!sidebarCollapsed && (
          <WorkspaceSidebar width={sidebarWidth} onWidthChange={setSidebarWidth}>
            <FolderTree selectedDocId={selectedDocId} onOpenDoc={openDoc} />
          </WorkspaceSidebar>
        )}
```
   (Remove the old `<aside className="w-64 …"><FolderTree …/></aside>` block.)

- [ ] **Step 6: Tokenize the connection dot in `WorkspaceLayout.tsx` + `src/index.css`**

The connection indicator currently uses `fill-green-500`/`text-green-500`, which won't adapt to light mode. Replace the `<Circle … />` className expression:
```tsx
              <Circle
                className={`h-2 w-2 ${
                  isOnline
                    ? 'fill-[hsl(var(--synced))] text-[hsl(var(--synced))]'
                    : 'fill-destructive text-destructive'
                }`}
              />
```
(`--synced` and `--destructive` are already defined for both themes in `index.css`; no CSS change is strictly required, but verify both tokens exist — they do.)

- [ ] **Step 7: Lint + build + full suite**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: clean lint; tests pass; build succeeds.

- [ ] **Step 8: Manual smoke**

`pnpm dev`: drag the right edge of the sidebar to resize (clamps 200–480, persists across reload); the top-bar panel button hides/shows the sidebar (persists); the sun/moon toggles theme; the connection dot is green when online in both themes.

- [ ] **Step 9: Commit**

```bash
git add src/components/workspace/WorkspaceSidebar.tsx \
        src/components/workspace/__tests__/WorkspaceSidebar.test.tsx \
        src/components/workspace/WorkspaceLayout.tsx src/index.css
git commit -m "$(cat <<'EOF'
feat(sidebar): resizable + collapsible sidebar, theme toggle in top bar

WorkspaceSidebar adds a drag/keyboard resize handle (clamped, width
persisted); a top-bar button collapses/expands the sidebar (persisted).
Places the ThemeToggle in the top bar and tokenizes the connection dot
so it adapts to light mode.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Folder `⋯` menu — add Info panel, move visibility into it

**Files:**
- Create: `src/components/folders/FolderInfoPanel.tsx`
- Test: `src/components/folders/__tests__/FolderInfoPanel.test.tsx`
- Modify: `src/components/folders/FolderVisibilityToggle.tsx`, `src/components/folders/FolderContextMenu.tsx`

**Interfaces:**
- Produces: `FolderInfoPanel({ folderId, folderAlias, currentVisibility, onClose })` — a centered modal.
- Changes: `FolderVisibilityToggle` now renders a `<Button>` (not a `DropdownMenuItem`); same props (`folderId`, `current`, `onError`).
- Consumes: `FolderSharingPanel` (embedded), `useFolderPermissions`.

- [ ] **Step 1: Write the failing test for `FolderInfoPanel`**

Create `src/components/folders/__tests__/FolderInfoPanel.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FolderInfoPanel } from '../FolderInfoPanel';

// Embedded children reach into data hooks; stub them to inert shells so
// the panel's own structure + close behavior is what we assert.
vi.mock('../FolderSharingPanel', () => ({
  FolderSharingPanel: ({ folderId }: { folderId: string }) => (
    <div data-testid="sharing">{folderId}</div>
  ),
}));
vi.mock('../FolderVisibilityToggle', () => ({
  FolderVisibilityToggle: () => <button>visibility</button>,
}));

describe('FolderInfoPanel', () => {
  it('renders the alias, embeds sharing, and closes on backdrop click', () => {
    const onClose = vi.fn();
    render(
      <FolderInfoPanel
        folderId="f1"
        folderAlias="Design"
        currentVisibility="Open"
        onClose={onClose}
      />,
    );
    expect(screen.getByText('Design')).toBeTruthy();
    expect(screen.getByTestId('sharing').textContent).toBe('f1');
    // backdrop is the dialog root; clicking it closes
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when the inner card is clicked', () => {
    const onClose = vi.fn();
    render(
      <FolderInfoPanel
        folderId="f1"
        folderAlias="Design"
        currentVisibility="Open"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText('Design'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/components/folders/__tests__/FolderInfoPanel.test.tsx`
Expected: FAIL — cannot resolve `../FolderInfoPanel`.

- [ ] **Step 3: Refactor `FolderVisibilityToggle.tsx` to a Button**

In `src/components/folders/FolderVisibilityToggle.tsx`:

1. Replace the import of `DropdownMenuItem` with the `Button`:
```tsx
import { Button } from '@/components/ui/button';
```
2. Replace the returned `<DropdownMenuItem>` with a button:
```tsx
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={onToggle}
      disabled={busy}
    >
      {current === 'Open' ? (
        <>
          <EyeOff className="h-3.5 w-3.5" />
          Make restricted
        </>
      ) : (
        <>
          <Eye className="h-3.5 w-3.5" />
          Make open
        </>
      )}
    </Button>
  );
```
Everything above the return (hooks, `canManageVisibility`/`current` guard, `onToggle`) is unchanged.

- [ ] **Step 4: Implement `FolderInfoPanel.tsx`**

Create `src/components/folders/FolderInfoPanel.tsx`:

```tsx
// Folder details modal, opened from the folder's "⋯ → Info" item.
// Shows the folder name, its visibility (with the change toggle for
// those who can manage it), and the members/sharing controls — which
// previously lived in the main pane (FolderSharingPanel), and now have
// their home here since the pane is the document editor.
//
// Centered-modal pattern (matches NamespaceCreateDialog) rather than an
// anchored popover: the trigger is a dropdown-menu item that closes its
// own menu on select, so a modal avoids fighting the menu for focus.

import React from 'react';
import { X, Globe, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FolderSharingPanel } from './FolderSharingPanel';
import { FolderVisibilityToggle } from './FolderVisibilityToggle';

interface Props {
  folderId: string;
  folderAlias: string;
  currentVisibility: 'Open' | 'Restricted' | undefined;
  onClose: () => void;
}

export function FolderInfoPanel({
  folderId,
  folderAlias,
  currentVisibility,
  onClose,
}: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-info-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="folder-info-title"
            className="truncate text-base font-semibold text-foreground"
          >
            {folderAlias}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {currentVisibility === 'Restricted' ? (
              <>
                <Lock className="h-3.5 w-3.5" aria-hidden />
                Restricted — explicit members only
              </>
            ) : currentVisibility === 'Open' ? (
              <>
                <Globe className="h-3.5 w-3.5" aria-hidden />
                Open — all workspace members
              </>
            ) : (
              'Loading visibility…'
            )}
          </span>
          {/* Self-hides unless the caller can manage visibility. */}
          <FolderVisibilityToggle folderId={folderId} current={currentVisibility} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <FolderSharingPanel folderId={folderId} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run src/components/folders/__tests__/FolderInfoPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Add the Info item to `FolderContextMenu.tsx` and remove the inline visibility item**

In `src/components/folders/FolderContextMenu.tsx`:

1. Add imports:
```tsx
import { Info } from 'lucide-react';
import { FolderInfoPanel } from './FolderInfoPanel';
```
   Remove the now-unused `FolderVisibilityToggle` import.
2. Get the folder alias for the panel title. Add `folders` to the `useDriveWorkspace()` destructure, then derive:
```tsx
  const folder = folders.find((f) => f.id === folderId);
  const folderAlias = folder?.alias ?? `${folderId.slice(0, 8)}…`;
```
3. Add panel open state next to `showNewSub`:
```tsx
  const [showInfo, setShowInfo] = useState(false);
```
4. **Always render the trigger.** Delete the `if (!anyAction) return null;` early-return (Info must be reachable by read-only viewers). You may delete the now-unused `anyAction` constant.
5. In `<DropdownMenuContent>`, remove the `<FolderVisibilityToggle … />` line and add an `Info` item (place it after "New subfolder", before the delete separator):
```tsx
          <DropdownMenuItem onClick={() => setShowInfo(true)}>
            <Info className="mr-2 h-4 w-4" />
            Info
          </DropdownMenuItem>
```
6. Render the panel alongside the existing `{showNewSub && …}` block:
```tsx
      {showInfo && (
        <FolderInfoPanel
          folderId={folderId}
          folderAlias={folderAlias}
          currentVisibility={currentVisibility}
          onClose={() => setShowInfo(false)}
        />
      )}
```

- [ ] **Step 7: Lint + build + full suite**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: clean lint; tests pass; build succeeds.

- [ ] **Step 8: Manual smoke**

`pnpm dev`: every folder row's `⋯` now shows `Rename · New subfolder · Info · Delete` (gated); a read-only folder shows at least `Info`; Info opens a modal with the visibility status + toggle and the member list; Esc / backdrop / X all close it.

- [ ] **Step 9: Commit**

```bash
git add src/components/folders/FolderInfoPanel.tsx \
        src/components/folders/__tests__/FolderInfoPanel.test.tsx \
        src/components/folders/FolderVisibilityToggle.tsx \
        src/components/folders/FolderContextMenu.tsx
git commit -m "$(cat <<'EOF'
feat(folders): consolidate folder actions into the ⋯ menu with an Info panel

Adds an Info item that opens a modal with the folder's visibility
(+ toggle) and members/sharing — relocating FolderSharingPanel out of
the main pane. Visibility toggle becomes a button; the ⋯ trigger now
always renders so read-only members can open Info.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Required display-name gate

**Files:**
- Create: `src/components/workspace/DisplayNameGate.tsx`
- Test: `src/components/workspace/__tests__/DisplayNameGate.test.tsx`
- Modify: `src/components/workspace/WorkspaceLayout.tsx`

**Interfaces:**
- Produces: `DisplayNameGate()` — renders null unless a gate is required; an absolutely-positioned overlay otherwise.
- Consumes: `useDriveWorkspace().{ namespaceId, selfIdentity }`; `useMemberDisplayName(nsId, memberId) → { name: string|null; loading; error; setName(next): Promise<void> }`; `MAX_DISPLAY_NAME_LEN`.

- [ ] **Step 1: Write the failing test**

Create `src/components/workspace/__tests__/DisplayNameGate.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DisplayNameGate } from '../DisplayNameGate';

const dnMock = vi.fn();
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ namespaceId: 'ns1', selfIdentity: 'me' }),
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  MAX_DISPLAY_NAME_LEN: 64,
  useMemberDisplayName: () => dnMock(),
}));

const setName = vi.fn().mockResolvedValue(undefined);

describe('DisplayNameGate', () => {
  beforeEach(() => {
    dnMock.mockReset();
    setName.mockClear();
  });

  it('renders nothing while the name is loading', () => {
    dnMock.mockReturnValue({ name: null, loading: true, error: null, setName });
    const { container } = render(<DisplayNameGate />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when a name is already set', () => {
    dnMock.mockReturnValue({ name: 'Ana', loading: false, error: null, setName });
    const { container } = render(<DisplayNameGate />);
    expect(container.firstChild).toBeNull();
  });

  it('blocks and saves when the name is null', async () => {
    dnMock.mockReturnValue({ name: null, loading: false, error: null, setName });
    render(<DisplayNameGate />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Your display name'), {
      target: { value: '  Ana Ruiz  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(setName).toHaveBeenCalledWith('Ana Ruiz'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/components/workspace/__tests__/DisplayNameGate.test.tsx`
Expected: FAIL — cannot resolve `../DisplayNameGate`.

- [ ] **Step 3: Implement `DisplayNameGate.tsx`**

Create `src/components/workspace/DisplayNameGate.tsx`:

```tsx
// Blocking "set your name" overlay. State-driven: it appears whenever
// the active namespace has no display name for the current member —
// which covers just-created, just-joined, and older nameless
// workspaces alike, with no per-event wiring. Gating on !loading
// avoids a flash for a name that is merely slow to resolve.
//
// Rendered INSIDE the workspace body (an `absolute inset-0` overlay
// over sidebar + main), NOT over the top bar — so the namespace
// switcher and Log out stay reachable as an escape hatch.

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import {
  useMemberDisplayName,
  MAX_DISPLAY_NAME_LEN,
} from '@/hooks/useMemberDisplayName';

export function DisplayNameGate() {
  const { namespaceId, selfIdentity } = useDriveWorkspace();
  const { name, loading, error, setName } = useMemberDisplayName(
    namespaceId,
    selfIdentity,
  );
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!namespaceId || !selfIdentity || loading || name !== null) return null;

  const trimmed = draft.trim();
  const canSave =
    trimmed.length > 0 && trimmed.length <= MAX_DISPLAY_NAME_LEN && !saving;

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setName(trimmed);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-gate-title"
      className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
        <h2 id="name-gate-title" className="text-lg font-semibold text-foreground">
          Set your name
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Members of this workspace see this name instead of your raw key. You
          can change it later in settings.
        </p>
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaveError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onSave();
          }}
          placeholder="Your display name"
          maxLength={MAX_DISPLAY_NAME_LEN}
          autoFocus
          disabled={saving}
          className="mt-4 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
        {error && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            Couldn&apos;t load: {error.message}
          </p>
        )}
        {saveError && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {saveError}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={() => void onSave()} disabled={!canSave}>
            {saving ? 'Saving…' : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/components/workspace/__tests__/DisplayNameGate.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Mount the gate in `WorkspaceLayout.tsx`**

In `src/components/workspace/WorkspaceLayout.tsx`:

1. Add the import:
```tsx
import { DisplayNameGate } from './DisplayNameGate';
```
2. Make the body row a positioning context and render the gate inside it. Change the main grid wrapper:
```tsx
      {/* Main grid */}
      <div className="relative flex flex-1">
```
3. As the **last child** inside that `<div className="relative flex flex-1">` (after `<main>`), add:
```tsx
        <DisplayNameGate />
```

- [ ] **Step 6: Lint + build + full suite**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: clean lint; tests pass; build succeeds.

- [ ] **Step 7: Manual smoke**

`pnpm dev`: join (or create) a workspace where you have no name → the gate blocks the sidebar + main pane but the top-bar workspace switcher and Log out still work; entering a name and clicking Continue dismisses it; switching to a workspace where your name is set shows no gate.

- [ ] **Step 8: Commit**

```bash
git add src/components/workspace/DisplayNameGate.tsx \
        src/components/workspace/__tests__/DisplayNameGate.test.tsx \
        src/components/workspace/WorkspaceLayout.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): require a display name before using a workspace

State-driven gate (fires when the active namespace's self-name is null)
blocks the sidebar + pane until a name is set, covering create/join/old
workspaces uniformly. Top-bar switcher and Log out stay reachable.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Inline editor + main-pane switch (retire full-screen + DocumentList)

Converts the editor from a full-screen takeover to an inline pane and replaces the folder's doc-list/sharing view with a quiet empty state (the sidebar lists docs; the Info panel hosts members).

**Files:**
- Modify: `src/components/editor/EditorShell.tsx`, `src/components/editor/EditorHeader.tsx`, `src/components/workspace/WorkspaceLayout.tsx`
- Create: `src/components/workspace/FolderEmptyState.tsx`
- Delete: `src/components/docs/DocumentList.tsx`

**Interfaces:**
- Consumes: `openDoc(folderId, docId)` (Task 2); `useDocs(folderId)`; `useFolderPermissions`.
- Produces: `FolderEmptyState({ folderId, onOpenDoc })`.

- [ ] **Step 1: Make `EditorShell` fill its container**

In `src/components/editor/EditorShell.tsx`, change both `h-screen` occurrences to `h-full`:

- The loading branch:
```tsx
      <div className="flex items-center justify-center h-full bg-background">
```
- The main render root:
```tsx
      <div className="flex flex-col h-full bg-background">
```
No other changes (toolbar/header/status bar stay for PR1).

- [ ] **Step 2: Drop the redundant logo from `EditorHeader`**

In `src/components/editor/EditorHeader.tsx`:

1. Remove `LogoWithText` from the imports.
2. In the left-side `<div className="flex items-center gap-4">`, remove the divider + logo so only the back button remains:
```tsx
      {/* Left side */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onBack}>
          <ChevronLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Documents</span>
        </Button>
      </div>
```
(Delete the `<div className="hidden sm:block w-px h-6 bg-border" />` and the `<LogoWithText … />` lines.)

- [ ] **Step 3: Write the failing test for `FolderEmptyState`**

Create `src/components/workspace/__tests__/FolderEmptyState.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FolderEmptyState } from '../FolderEmptyState';

const useDocsMock = vi.fn();
vi.mock('@/hooks/useDocs', () => ({ useDocs: () => useDocsMock() }));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ namespaceId: 'ns1' }),
}));
const permsMock = vi.fn();
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => permsMock(),
}));

describe('FolderEmptyState', () => {
  beforeEach(() => {
    useDocsMock.mockReset();
    permsMock.mockReset();
  });

  it('creates and opens a doc when allowed', async () => {
    const create = vi.fn().mockResolvedValue('newdoc');
    useDocsMock.mockReturnValue({ create, contextId: 'ctx1' });
    permsMock.mockReturnValue({ canEditDocs: true });
    const onOpenDoc = vi.fn();
    render(<FolderEmptyState folderId="f1" onOpenDoc={onOpenDoc} />);
    fireEvent.click(screen.getByRole('button', { name: /New document/i }));
    await waitFor(() => expect(onOpenDoc).toHaveBeenCalledWith('f1', 'newdoc'));
  });

  it('hides the create button for read-only members', () => {
    useDocsMock.mockReturnValue({ create: vi.fn(), contextId: 'ctx1' });
    permsMock.mockReturnValue({ canEditDocs: false });
    render(<FolderEmptyState folderId="f1" onOpenDoc={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /New document/i })).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm exec vitest run src/components/workspace/__tests__/FolderEmptyState.test.tsx`
Expected: FAIL — cannot resolve `../FolderEmptyState`.

- [ ] **Step 5: Implement `FolderEmptyState.tsx`**

Create `src/components/workspace/FolderEmptyState.tsx`:

```tsx
// Main-pane content for "a folder is open but no document is selected".
// A quiet invitation to act: a New-document CTA (for editors) that
// creates an Untitled doc and opens it inline. Read-only members get
// guidance to pick a doc from the sidebar instead.

import React, { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useDocs } from '@/hooks/useDocs';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';

interface Props {
  folderId: string;
  onOpenDoc: (folderId: string, docId: string) => void;
}

export function FolderEmptyState({ folderId, onOpenDoc }: Props) {
  const { namespaceId } = useDriveWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const docs = useDocs(folderId);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const id = await docs.create({ title: 'Untitled' });
      onOpenDoc(folderId, id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <FileText
          className="mx-auto h-8 w-8 text-muted-foreground/60"
          aria-hidden
        />
        <h2 className="mt-3 text-lg font-semibold text-foreground">
          No document open
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {perms.canEditDocs
            ? 'Pick a document from the sidebar, or create a new one.'
            : 'Pick a document from the sidebar to start reading.'}
        </p>
        {perms.canEditDocs && docs.contextId && (
          <Button
            className="mt-4 gap-1.5"
            size="sm"
            disabled={creating}
            onClick={onCreate}
          >
            <Plus className="h-4 w-4" />
            {creating ? 'Creating…' : 'New document'}
          </Button>
        )}
        {error && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            Create failed: {error}
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm exec vitest run src/components/workspace/__tests__/FolderEmptyState.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Rewire `WorkspaceLayout.tsx` — remove early-return, switch the pane, drop DocumentList**

In `src/components/workspace/WorkspaceLayout.tsx`:

1. Remove the imports for `DocumentList` and `FolderSharingPanel`; add `FolderEmptyState`:
```tsx
import { FolderEmptyState } from './FolderEmptyState';
```
   (Delete: `import { DocumentList } from '@/components/docs/DocumentList';` and `import { FolderSharingPanel } from '@/components/folders/FolderSharingPanel';`)
2. **Delete the full-screen editor early-return block** — the `if (selectedFolderId && selectedDocId) { return ( <DocumentEditor … /> ); }` near the top of the component (and its long comment). The editor now renders inside the pane (below).
3. Make `<main>` a flex column that contains its own scroll, so the inline editor can fill it while empty states still scroll:
```tsx
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
```
4. Replace the body of `<main>` (the entire `{showSettings ? … : … }` expression) with the pane switch below. The `selectedFolder`, `selectedFolderPerms`, `isAccessDeniedError`, `stage`, etc. are already in scope from the top of the component:
```tsx
          {showSettings && namespaceId ? (
            <div className="flex-1 overflow-y-auto">
              <NamespaceSettingsPanel key={`settings:${namespaceId}`} />
            </div>
          ) : !namespaceId ? (
            <EmptyState
              title="No workspace selected"
              body="Create or pick a workspace from the top bar to see your folders."
            />
          ) : stage === 'syncing-from-peers' ? (
            <EmptyState
              title="Syncing workspace from peers…"
              body="You've just joined this workspace. Waiting for the registry and folder state to propagate from other nodes. This usually takes a second."
            />
          ) : !selectedFolder ? (
            <EmptyState
              title="Select a folder"
              body="Pick a folder from the left rail to see its documents."
            />
          ) : selectedFolderPerms.loading ? (
            <EmptyState title="Checking access…" body="" />
          ) : (selectedFolderPerms.error &&
              isAccessDeniedError(selectedFolderPerms.error)) ||
            (!selectedFolderPerms.isMember && !selectedFolderPerms.error) ? (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="mx-auto max-w-3xl">
                <RestrictedFolderCard
                  folderId={selectedFolder.id}
                  folderAlias={selectedFolder.alias}
                  visibility={selectedFolder.visibility}
                  selfIdentity={selfIdentity}
                  refetch={refetch}
                  refetchPerms={selectedFolderPerms.refetch}
                />
              </div>
            </div>
          ) : selectedDocId ? (
            <DocumentEditor
              key={`${selectedFolder.id}:${selectedDocId}`}
              folderId={selectedFolder.id}
              docId={selectedDocId}
              onClose={() => setSelectedDocId(null)}
            />
          ) : (
            <FolderEmptyState folderId={selectedFolder.id} onOpenDoc={openDoc} />
          )}
```
5. Ensure the `EmptyState` helper at the bottom of the file fills the pane — it already uses `flex h-full items-center justify-center`, which is correct inside the flex column.

- [ ] **Step 8: Delete `DocumentList.tsx`**

```bash
git rm src/components/docs/DocumentList.tsx
```
If `pnpm lint` later flags a dangling import anywhere, grep and remove it:
```bash
grep -rn "DocumentList" src || echo "no references"
```
Expected: `no references`.

- [ ] **Step 9: Lint + build + full suite**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: clean lint; tests pass; build succeeds.

- [ ] **Step 10: Manual smoke (required — the core UX change)**

`pnpm dev`: select a folder → quiet empty state with a "New document" CTA; click a doc in the sidebar → the editor renders **inline** with the sidebar + top bar still present; the editor's "Documents" back button returns to the empty state; switching docs across folders preserves selection; typing autosaves (status bar) and switching docs flushes; restricted folders still show the join card.

- [ ] **Step 11: Commit**

```bash
git add src/components/editor/EditorShell.tsx \
        src/components/editor/EditorHeader.tsx \
        src/components/workspace/WorkspaceLayout.tsx \
        src/components/workspace/FolderEmptyState.tsx \
        src/components/workspace/__tests__/FolderEmptyState.test.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): inline document editor in a persistent shell

Retire the full-screen editor takeover: the editor now renders inline
in the main pane (EditorShell fills its container; header loses the
redundant logo). The folder view becomes a quiet empty state with a
New-document CTA; DocumentList is removed (the sidebar lists docs, the
Info panel hosts members). DocumentEditor orchestration is unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage (PR1 = decisions 1–6, 10):**
- Decision 1 (persistent shell, inline editor) → Task 6 (+ groundwork in Task 2). ✓
- Decision 2 (unified folders+docs sidebar, lazy, resizable, collapsible) → Tasks 2 + 3. ✓
- Decision 3 (quiet empty state) → Task 6 (`FolderEmptyState`). ✓
- Decision 4 (`⋯` menu + Info panel) → Task 4. ✓
- Decision 5 (required name gate) → Task 5. ✓
- Decision 6 (light/dark toggle) → Task 1. ✓
- Decision 10 (refine identity, tokenized sync dot) → Task 3 (dot) + density via Tailwind classes throughout. ✓ (Editor reading-experience typography is PR2.)

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Every code step shows full code; every test step shows real assertions. ✓

**3. Type consistency:** `onOpenDoc: (folderId: string, docId: string) => void` is consistent across `FolderDocLeaves`, `FolderTree`, `FolderTreeItem`, `FolderEmptyState`, and WorkspaceLayout's `openDoc`. `FolderVisibilityToggle` keeps `{folderId, current, onError}` (now renders a Button). `useDocs` fields used (`list/create/contextId/contextResolving/loading/error`) match `DocumentList`'s original usage. ✓

**Notes / deviations from the spec (intentional, lower-risk):**
- `FolderInfoPanel` is a centered modal (existing dialog pattern), not a Radix popover → **no `@radix-ui/react-popover` dependency added** in PR1.
- `FolderSharingPanel` is **embedded/reused** inside the Info panel, not deleted.
- The cross-folder doc-selection guard (WorkspaceLayout `openDoc` + ref) is verified via Tasks 2/6 manual smoke + build rather than a unit test (it's integrative WorkspaceLayout state); the unit-testable pieces (`FolderDocLeaves`, `FolderEmptyState`) are covered.

---

## Out of scope (PR2 — separate plan)

Editor UX overhaul: in-body title (`DocumentTitleInput`), slash command menu, selection bubble menu, removal of `EditorToolbar`/`EditorHeader`, and the editor papercut fixes (heading/list bug reproduce-first, per-block placeholders, link popover, click-to-focus). See spec §7–§8.
