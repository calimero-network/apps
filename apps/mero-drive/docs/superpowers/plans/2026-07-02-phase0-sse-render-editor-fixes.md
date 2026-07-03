# Phase 0 — SSE/render churn + editor caret + node-status fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the sidebar twitching, keep the editor caret in place on remote refreshes, and stop the node-status dot from flapping red — without regressing the permission live-refresh path.

**Architecture:** All three bugs share one shared `SseClient` whose events fan to every handler and drive un-guarded refetch/re-render. Fixes are surgical: dedupe/diff-guard state so identical data doesn't re-render, debounce the workspace refetch, preserve the caret across `replaceBlocks`, and add a grace period to the online indicator. No `strict`-mode change on `useMemberCaps` (it drops governance events — a known past regression).

**Tech Stack:** React 19, TypeScript, BlockNote editor, `@calimero-network/mero-react` SSE, Vitest.

Spec: `docs/superpowers/specs/2026-07-02-collab-editing-and-sse-fixes-design.md` (Phase 0).

## Global Constraints

- Branch: `feat/collab-editing-and-sse-fixes`, based on merged master `316ffac`.
- Every task ends green: `pnpm test`, `pnpm lint:src` (eslint `--max-warnings 0`), `npx tsc --noEmit` (app tsconfig, `skipLibCheck`), `pnpm build`.
- Do NOT switch `useMemberCaps`/`useFolderRole` to `strict` — they must keep reacting to governance events on their subscribed context. Fix churn by diff-guarding state, not by dropping events.
- Items 0c–0f change runtime behaviour on delicate paths (permission-gated UI, editor, auth). Unit tests can't prove "no twitch"/"caret held"/"dot steady" — each carries a **mandatory live multi-user verification step** in the running app before its commit is considered done.
- No `#NNNN`/issue refs in source comments (repo rule); explanation goes in commit/PR body.
- Commit after each task.

---

### Task 0a: Dedupe identical sync-status snapshots (DONE — verify + commit)

Already implemented in the working tree; this task records and locks it.

**Files:**
- Modify: `app/src/hooks/useSyncStatus.ts` (added `sameSnapshot`, functional `setLatest`)
- Test: `app/src/hooks/__tests__/useSyncStatus.test.ts` (added stable-reference test)

**Interfaces:**
- Produces: `useSyncStatus` returns a **stable reference** when consecutive snapshots are field-identical (React skips the re-render).

- [ ] **Step 1: Confirm the test exists and passes**

Run: `cd app && npx vitest run src/hooks/__tests__/useSyncStatus.test.ts`
Expected: PASS (12 tests), including "returns a stable reference when consecutive snapshots are identical".

- [ ] **Step 2: Full gates**

Run: `cd app && pnpm lint:src && npx tsc --noEmit && pnpm test`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add app/src/hooks/useSyncStatus.ts app/src/hooks/__tests__/useSyncStatus.test.ts
git commit -m "fix(workspace): dedupe identical sync-status snapshots to cut provider re-renders"
```

---

### Task 0b: Memoize the `useDriveWorkspace` provider value

**Files:**
- Modify: `app/src/hooks/useDriveWorkspace.ts` (the `return { … }` at ~`:1074` in `useDriveWorkspaceInternal`)

**Interfaces:**
- Consumes: all local state/callbacks already in scope at the return.
- Produces: `useDriveWorkspaceInternal` returns a `useMemo`-stabilized object; identity changes only when a listed dependency changes.

- [ ] **Step 1: Read the exact return block**

Run: `cd app && sed -n '1038,1068p' src/hooks/useDriveWorkspace.ts` (confirm the full field list before editing).

- [ ] **Step 2: Wrap the return in `useMemo`**

Replace `return { …all fields… };` with a memo whose dependency array lists exactly the values referenced (state, derived memos like `folders`/`allFolderNodes`/`registryAdmin`, and the stable `useCallback` handlers). Example shape:

```tsx
const value = useMemo<DriveWorkspaceState>(
  () => ({
    applicationId,
    selfIdentity: selfIdentity ?? contextIdentity ?? null,
    namespaceMemberNames,
    namespaces,
    selectedNamespaceId: selectedNsId,
    namespaceId: selectedNsId,
    rootGroupId,
    selectNamespace,
    clearNamespace,
    createWorkspace,
    createWorkspaceLoading: createLoading,
    createWorkspaceError: createError,
    registryContextId,
    registryClient,
    folders,
    allFolderNodes,
    registryAdmin,
    selectedFolderId,
    setSelectedFolder,
    loading,
    stage,
    syncStatus,
    error,
    refetch,
  }),
  [
    applicationId, selfIdentity, contextIdentity, namespaceMemberNames,
    namespaces, selectedNsId, rootGroupId, selectNamespace, clearNamespace,
    createWorkspace, createLoading, createError, registryContextId,
    registryClient, folders, allFolderNodes, registryAdmin, selectedFolderId,
    setSelectedFolder, loading, stage, syncStatus, error, refetch,
  ],
);
return value;
```

Note: this only helps once the underlying memos (`folders`, `registryAdmin`) also stop churning — Task 0d stabilizes `folders`. The eslint `react-hooks/exhaustive-deps` rule will flag a wrong dep list; make it pass with zero warnings.

- [ ] **Step 3: Gates**

Run: `cd app && pnpm lint:src && npx tsc --noEmit && pnpm test`
Expected: green, no exhaustive-deps warning.

- [ ] **Step 4: Live check**

Run the app (`pnpm dev`), open a workspace, idle. React DevTools Profiler: the provider consumers should stop re-rendering on every background sync tick (combined with 0a). Note: full twitch relief needs 0c+0d too.

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useDriveWorkspace.ts
git commit -m "perf(workspace): memoize provider value so unchanged state stops re-rendering consumers"
```

---

### Task 0c: Diff-guard per-row caps/role so identical fetches don't re-render

Stops every folder row re-rendering (and re-fetching) on each doc-autosave SSE event, without dropping governance events (no `strict`).

**Files:**
- Modify: `app/src/hooks/useFolderRole.ts` (the fetch's `setRoleState`)
- Modify: `app/src/hooks/useMemberCaps.ts` (the fetch's `setState`)
- Test: `app/src/hooks/__tests__/useFolderRole.test.ts`, `app/src/hooks/__tests__/useMemberCaps.test.ts`

**Interfaces:**
- Produces: both hooks call their setter only when the fetched value differs from current state; an SSE tick that yields the same role/caps causes no state change (no re-render).

- [ ] **Step 1: Failing test — `useFolderRole` no-ops on identical re-fetch**

Add a test (mirror the existing file's mocking of `registryClient.getFolderRole` and `useContextEvents`) that: renders with a folder whose role resolves to `Editor`; fires a second `useContextEvents` tick returning `Editor` again; asserts the component does NOT re-render / `role` reference/҂value is unchanged (track render count via a ref counter in the test component).

```ts
// pseudo-shape — match existing test harness in the file
it('does not re-render when a refetch returns the same role', async () => {
  getFolderRole.mockResolvedValue('Editor');
  const renders = renderCounter();
  // initial resolve → Editor
  await waitFor(() => expect(result.current.role).toBe('Editor'));
  const before = renders.count;
  act(() => fireContextEvent());          // SSE tick
  await waitFor(() => {});                  // fetch resolves same value
  expect(renders.count).toBe(before);      // no extra render
});
```

- [ ] **Step 2: Run — expect FAIL** (`cd app && npx vitest run src/hooks/__tests__/useFolderRole.test.ts`).

- [ ] **Step 3: Implement diff-guard in `useFolderRole`**

In the fetch success path, only update when changed:

```tsx
setRoleState((prev) => (prev === fetchedRole ? prev : fetchedRole));
```

(`Role` is a string union, so `===` is a correct value compare.)

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Repeat for `useMemberCaps`** — write the failing test (same shape, caps unchanged), then guard the setter. Caps is an object, so compare by field:

```tsx
setState((prev) =>
  prev.caps === caps && prev.isAdmin === isAdmin && prev.error === error
    ? prev
    : { caps, isAdmin, error },
);
```

If `caps` is a bitmask number, `prev.caps === caps` suffices; if it's an object/array, compare its stable serialization. Confirm the caps type in the file before choosing.

- [ ] **Step 6: Gates** (`pnpm lint:src && npx tsc --noEmit && pnpm test`).

- [ ] **Step 7: LIVE multi-user verification (mandatory)**

Two sessions. In session A, type in a doc (autosave every ~900ms). Session B's sidebar rows must NOT twitch/re-render on A's autosaves. THEN in A, change a folder role/membership for B — B's row must still update live (governance events not dropped). Both must hold.

- [ ] **Step 8: Commit**

```bash
git add app/src/hooks/useFolderRole.ts app/src/hooks/useMemberCaps.ts app/src/hooks/__tests__/useFolderRole.test.ts app/src/hooks/__tests__/useMemberCaps.test.ts
git commit -m "perf(folders): diff-guard row caps/role so identical SSE refetches don't re-render or refetch"
```

---

### Task 0d: Debounce workspace refetch + stabilize `folders` identity

**Files:**
- Modify: `app/src/hooks/useDriveWorkspace.ts` (`loadRegFolders` `setRegFolders` at `:555-562`; the `onWorkspaceEvent`/`refetch` wiring at `:928-943`)

**Interfaces:**
- Produces: `regFolders` keeps a stable array identity when fetched content is unchanged; SSE-driven `refetch` is debounced (~300ms) so a burst of events causes one refetch.

- [ ] **Step 1: Diff-guard `setRegFolders`**

Compare the newly-mapped folder list to the previous by stable serialization and keep the old reference when equal, so the `folders` memo (and `allFolderNodes`) don't get a fresh identity for byte-identical data:

```tsx
const mapped = fs.map((f) => ({
  id: f.id,
  parent_id: f.parent_id ?? null,
  color: f.color ?? null,
  alias: f.alias ?? null,
}));
setRegFolders((prev) =>
  JSON.stringify(prev) === JSON.stringify(mapped) ? prev : mapped,
);
```

(`JSON.stringify` compare is fine for these small flat rows; document the ceiling.)

- [ ] **Step 2: Debounce the SSE-driven refetch**

Wrap `onWorkspaceEvent` so rapid events coalesce into one `refetch()` (~300ms trailing). Keep a stable handler identity (ref-held timer) so the subscription doesn't churn:

```tsx
const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
const onWorkspaceEvent = useCallback(() => {
  if (refetchTimer.current) clearTimeout(refetchTimer.current);
  refetchTimer.current = setTimeout(() => {
    refetchTimer.current = null;
    void refetch();
  }, 300);
}, [refetch]);
useEffect(() => () => {
  if (refetchTimer.current) clearTimeout(refetchTimer.current);
}, []);
```

- [ ] **Step 3: Gates** (`pnpm lint:src && npx tsc --noEmit && pnpm test`).

- [ ] **Step 4: LIVE verification (mandatory)**

Idle workspace: the folder tree must not rebuild on every background sync tick (React DevTools: `FolderTree`/rows stop re-rendering when nothing changed). THEN create/rename/recolor a folder in another session — it must still appear within ~1s (debounce, not drop).

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useDriveWorkspace.ts
git commit -m "perf(workspace): debounce SSE refetch and keep folders identity stable when unchanged"
```

---

### Task 0e: Preserve the editor caret across remote `replaceBlocks`

**Files:**
- Modify: `app/src/components/editor/EditorShell.tsx` (`:182-188`, the remote-apply effect)

**Interfaces:**
- Produces: after a remote content apply, the local text cursor is restored to its prior position when still valid (no jump to document start).

- [ ] **Step 1: Confirm the BlockNote caret API**

Run: `cd app && grep -rn "getTextCursorPosition\|setTextCursorPosition" node_modules/@blocknote/core/types` (confirm the method names + shape: `getTextCursorPosition()` returns `{ block, prevBlock, nextBlock }`; `setTextCursorPosition(blockIdentifier, placement?)`). Implement against the confirmed signature.

- [ ] **Step 2: Save/restore around `replaceBlocks`**

```tsx
applyingRemoteRef.current = true;
const priorCursor = editor.getTextCursorPosition?.();
try {
  editor.replaceBlocks(editor.document, blocks);
  lastContentRef.current = initialContent;
  // Restore caret if its block survived the replace; else leave default.
  const targetId = priorCursor?.block?.id;
  if (targetId && editor.document.some((b) => b.id === targetId)) {
    try { editor.setTextCursorPosition(targetId, 'end'); } catch { /* block gone */ }
  }
} finally {
  applyingRemoteRef.current = false;
}
```

Note: BlockNote regenerates block ids on `replaceBlocks` from serialized JSON, so id-match may miss; if so, fall back to restoring by block **index** (clamp to `editor.document.length - 1`). Choose whichever the live check proves keeps the caret.

- [ ] **Step 3: Gates** (`pnpm lint:src && npx tsc --noEmit && pnpm test`).

- [ ] **Step 4: LIVE verification (mandatory)**

Two sessions on one doc. Place caret mid-paragraph in A and stop typing. Edit from B. A's caret must stay put (not jump to the top). Confirm own-save echo also no longer moves the caret.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/editor/EditorShell.tsx
git commit -m "fix(editor): preserve caret when applying a remote content update"
```

---

### Task 0f: Grace period on the node-status dot

**Files:**
- Create: `app/src/hooks/useOnlineStatus.ts`
- Test: `app/src/hooks/__tests__/useOnlineStatus.test.ts`
- Modify: `app/src/components/workspace/WorkspaceLayout.tsx` (`:64` read, `:172-187` render)

**Interfaces:**
- Produces: `useOnlineStatus(): boolean` — wraps `useMero().isOnline`; returns `true` immediately, but only returns `false` after the underlying `isOnline` has stayed false continuously for `OFFLINE_GRACE_MS` (default 5000). A blip that recovers within the window never shows red.

- [ ] **Step 1: Failing test**

```ts
import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
let online = true;
vi.mock('@calimero-network/mero-react', () => ({ useMero: () => ({ isOnline: online }) }));
import { useOnlineStatus } from '../useOnlineStatus';

it('stays online through a brief blip, reds only after the grace window', () => {
  vi.useFakeTimers();
  online = true;
  const { result, rerender } = renderHook(() => useOnlineStatus(1000));
  online = false; rerender();
  act(() => { vi.advanceTimersByTime(500); });
  expect(result.current).toBe(true);          // within grace → still green
  online = true; rerender();                   // recovered
  act(() => { vi.advanceTimersByTime(1000); });
  expect(result.current).toBe(true);
  online = false; rerender();
  act(() => { vi.advanceTimersByTime(1000); });
  expect(result.current).toBe(false);          // sustained offline → red
});
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run src/hooks/__tests__/useOnlineStatus.test.ts`).

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';

const DEFAULT_OFFLINE_GRACE_MS = 5000;

/** `isOnline` from the SDK flaps on transient SSE errors (a failed subscribe
 *  POST, a reconnect blip) with no debounce. Show green immediately, but only
 *  surface red after it's been offline continuously past the grace window. */
export function useOnlineStatus(graceMs = DEFAULT_OFFLINE_GRACE_MS): boolean {
  const { isOnline } = useMero();
  const [display, setDisplay] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isOnline) {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      setDisplay(true);
      return;
    }
    if (timer.current) return; // already counting down
    timer.current = setTimeout(() => { timer.current = null; setDisplay(false); }, graceMs);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [isOnline, graceMs]);
  return display;
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Use it in `WorkspaceLayout`**

Replace `const { mero, nodeUrl, isOnline, logout } = useMero();` — drop `isOnline` from that destructure and add `const isOnline = useOnlineStatus();` below it. The `:172-187` render is unchanged (still reads `isOnline`).

- [ ] **Step 6: Gates** (`pnpm lint:src && npx tsc --noEmit && pnpm test`).

- [ ] **Step 7: LIVE verification (mandatory)**

Trigger a transient SSE blip (e.g. switch namespaces rapidly, or briefly drop network for <5s): the dot must stay green. Kill the node / stay offline >5s: it goes red. Recovery flips it back green.

- [ ] **Step 8: Commit**

```bash
git add app/src/hooks/useOnlineStatus.ts app/src/hooks/__tests__/useOnlineStatus.test.ts app/src/components/workspace/WorkspaceLayout.tsx
git commit -m "fix(workspace): grace period on node-status dot so transient SSE blips don't flap red"
```

---

### Task 0g: Full verification + open PR

- [ ] **Step 1: Full gates**

Run: `cd app && pnpm test && pnpm lint:src && npx tsc --noEmit && pnpm build`
Expected: all green.

- [ ] **Step 2: Re-run the live checks from 0c/0d/0e/0f together** in a two-session setup (twitch, caret, dot all correct simultaneously — confirm no interaction regressions).

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/collab-editing-and-sse-fixes
gh pr create --base master --title "fix(workspace): stop sidebar twitch, caret jump, and node-red flapping" --body "<summary of 0a–0f, root causes, and the live-verification done>"
```

- [ ] **Step 4:** Resolve bot review threads (use the `resolve-bot-review-comments` skill).

## Self-Review notes

- Spec coverage: 0a→#1(3), 0b→#1(2), 0c→#1(1), 0d→#1(4)+#2 feed, 0e→#2, 0f→#3. All Phase-0 spec items mapped.
- The one deliberately-deferred spec idea (drop 401 auto-logout) is folded into 0f's scope as optional; keep it minimal — grace period is the required part.
- Non-unit-testable items (0c–0e twitch/caret, 0f live blip) carry explicit live steps; that is intentional, not a placeholder.
