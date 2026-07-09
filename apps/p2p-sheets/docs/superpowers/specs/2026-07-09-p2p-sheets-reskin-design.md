# p2p-sheets reskin — design

**Date:** 2026-07-09
**Status:** Approved (pending spec review)
**Scope:** Presentation-only reskin of the open-workspace UI to the landing-page "your node" aesthetic. No spreadsheet behavior changes.

---

## Goal

Reskin the open-workspace surfaces of the p2p-sheets app — the header, formula
bar, grid, and a new status footer — to match the dark greenish-black "your
node" window mockup on the landing page (`app/src/pages/landing/LandingPage.tsx`,
`LivePreview`): window chrome with traffic-lights, a node-identity title, a live
collaborator avatar bar, live/sync status indicators, and a dark grid.

This is a **visual redesign**. No changes to spreadsheet logic, data flow,
selection/edit/point-mode behavior, clipboard, formulas, or the WASM logic.
The only new *component* is a status footer; everything else is restyling
existing components and adding presence-driven chrome that reads already-present
state (`ss.cursors`, `ss.cells`, connection/load state).

## Non-goals

- The workspace picker / welcome gate (`FullCenter` / `WelcomeCard` states in
  `AppPage`) stays as-is. Only the **open workspace** view (state 3) is reskinned.
- No changes to `SheetTabs`, modals (`InviteModal`, `JoinModal`), `ContextMenu`,
  `FunctionHelpPanel` internals beyond inheriting the retuned dark tokens.
- No new dependencies. Styling stays in styled-components + the existing CSS-var
  token system.

---

## Global constraints

- **Dark by default, light kept.** The app must default to dark mode but keep a
  working light theme and a user toggle. Existing `useTheme`/`applyTheme` in
  `app/src/theme.ts` and tokens in `app/src/index.css` are the mechanism.
- **Real data only for presence/status.** The live pill, collaborator avatars,
  and sync footer must derive from real state (`ss.cursors`, `ss.cells`,
  `ss.loaded`, in-flight mutations, connection state). No faked animation or
  hard-coded peer counts. When there are no peers present, the avatar bar shows
  only the local user.
- **No behavior regressions.** All existing props, handlers, and `data-testid`
  attributes on interactive controls are preserved. The 97-test suite
  (`app` vitest) must stay green.
- **Accent color** is `#a4ff11` (bright green) in both themes; text-on-accent
  stays dark (`--c-on-accent: #0e140f`).

---

## Theme retune

**Default flip.** `getStoredTheme()` in `app/src/theme.ts` currently defaults to
`'light'`. Change the fallback to `'dark'` (both the `try` return and the
`catch`), so a first-time visitor with no stored preference gets dark. A stored
preference still wins.

**Dark palette retune** (in `app/src/index.css`, `:root[data-theme='dark']`).
Retune toward the mockup's greenish-black. Target values:

| Token | Current | New |
|---|---|---|
| `--c-paper` | `#14181d` | `#0f1511` |
| `--c-paper2` | `#1b2027` | `#141a14` |
| `--c-line` | `#2b313a` | `rgba(164,255,17,0.10)` |
| `--c-ink` | `#e7edf2` | `#e8efe6` |
| `--c-muted` | `#9aa6ad` | `#8a978a` |
| `--c-muted-soft` | `#6d7884` | `#5f6b5f` |

**New token** for the deepest chrome/footer surface (title bar, status footer),
added to both themes:

- `--c-chrome`: light `#f5f8f1`, dark `#0b0f0c`.

Exposed in `app/src/theme.ts` as `C.chrome = 'var(--c-chrome)'`.

Light mode values are unchanged except adding `--c-chrome`.

---

## Header — two-tier window chrome

Replaces the single-row `Toolbar` (`AppPage.tsx:749–825`) in the open-workspace
view with a two-tier `<header>`. Same actions and handlers; new arrangement.

### Row 1 — title bar (`--c-chrome` background)

Left → right:

1. **Traffic-lights** — three 10px dots (`#ff5f56`, `#ffbd2e`, `#a4ff11`).
   Purely decorative, `aria-hidden`, not interactive.
2. **Back button** (`←`) — existing `BackBtn` handler (commit-if-dirty then
   `ws.leaveWorkspace()`). Keeps its `aria-label="Back to workspaces"`.
3. **Logo mark** (`⬡` or the existing `GridIcon` svg) in green.
4. **Workspace name** (`activeWorkspaceName`) as the bold title, followed by a
   muted **`· your node`** suffix.
5. **Live pill** (right-aligned) — `● live` in green when connected/subscribed;
   `○ offline` muted when not. See "Presence & status data" below.

### Row 2 — collaborator bar (`--c-paper` background)

Left → right:

1. **Avatar stack** — one circular avatar per distinct author in `ss.cursors`
   on the active context (overlapping, -6px margin). Fill = the cursor's
   `color`; label = derived initials (see below). The local user
   (author === `ws.executorPublicKey`) is always shown, marked with a ring
   and ordered first.
2. **"N collaborators"** muted label, where N = distinct-author count
   (including self).
3. **Actions** (right-aligned), preserving every existing control and its
   `data-testid`/`aria-label`:
   - **Invite** — green primary button (opens `InviteModal`).
   - **Join** — secondary (opens `JoinModal`).
   - **Download** (`action-export_all`), **Functions** — existing `ToolBtn`s.
   - **Theme toggle** — new: the `◐` / `MoonIcon` control calling
     `useTheme().toggle`. (There is currently no toggle in the UI.)
   - **Sign out** — existing `SignOutBtn` (`logout`).

Responsive: below ~700px the action button text labels collapse to icons
(existing `@media (max-width:700px) { span { display:none } }` pattern), and
the collaborator label may hide, but avatars and the live pill remain.

### Avatar initials

Author identifiers are opaque public keys, not names. Derive a stable 1–2 char
label: take the cursor `author` string, and use the existing convention already
in the grid (`SpreadsheetGrid.tsx:438` uses `cursor.author.slice(0, 3)` for
cursor tags). For avatars use `author.slice(0, 2).toUpperCase()`. The local
user's avatar shows the same, plus the ring marker. (Human-name mapping is out
of scope — no identity directory exists.)

---

## Formula bar — dark restyle

`app/src/components/FormulaBar.tsx`: no structural or prop changes. Restyle to
the dark surface: `--c-paper`/`--c-chrome` background, a green cell-ref chip
(the `cellRef` display), muted `fx` affordance, `--c-ink` input text. The
existing commit/cancel `CommitBar` (`AppPage.tsx:847–866`) inherits the tokens.

All keyboard, clipboard (`onCopy`/`onCut`/`onPaste`), and delete routing is
unchanged.

---

## Grid — dark restyle

`app/src/components/SpreadsheetGrid.tsx`: no structural or prop changes. The
component already renders (a) colored per-author cursor outlines
(`$cursorColor`, `SpreadsheetGrid.tsx:561`) and (b) cursor name tags
(`CursorTag`, `:437`). Restyle only:

- Dark cell surfaces (`--c-paper`), green-tinted hairlines
  (`--c-line`), dark column/row headers (`--c-chrome`).
- Selection outline: green (`--c-green`, 2px inset), matching the mockup.
- Peer edit borders: keep per-author `color` outline; ensure it reads on the
  dark surface. Cursor tags keep the author color background.
- In-range / fill-target / copied-region styling retuned for dark contrast
  (existing `$inRange`, `$inFillTarget`, `$copied` states).

No change to selection, drag, fill, point-mode, or context-menu behavior.

---

## Status footer — new component

**New file:** `app/src/components/StatusBar.tsx`.

A thin bar (`--c-chrome` background, top hairline) rendered below `SheetTabs`
in the open-workspace view. Content (single line, left-aligned):

```
● Synced · N peers · M cells
```

- **Sync dot + word:** green `●` + `Synced` when `ss.loaded` is true and no
  mutation is in flight; amber/muted `◐` + `Syncing…` while `ss.loaded` is
  false OR a mutation is in flight.
- **N peers:** distinct-author count from `ss.cursors` on the active context,
  **excluding** the local user (so "peers" = other people). `0 peers` is a
  valid, shown state.
- **M cells:** `ss.cells.length` for the workspace.

### Props

```ts
interface StatusBarProps {
  synced: boolean;   // false → "Syncing…"
  peers: number;     // other authors present (excludes self)
  cells: number;     // total non-blank cells
}
```

`AppPage` computes and passes these; `StatusBar` is pure presentation.

---

## Presence & status data

All derived in `AppPage` from existing hooks — no new data fetching:

- **Live pill (connected):** true when the workspace is ready and subscribed.
  Use `ss.ready && ss.loaded` as the connected signal (the spreadsheet hook is
  live once its first fetch resolves against a ready context). If a more
  precise connection signal is exposed by `useSpreadsheet`/`useWorkspace` at
  implementation time, prefer it; otherwise this is the contract.
- **Sync (`synced`) for the footer:** `ss.loaded && !mutationInFlight`.
  `mutationInFlight` is derived from the existing mutation queue in
  `useSpreadsheet` (the serialized `enqueue` chain). If the hook does not
  already expose a pending-count, add a minimal boolean/counter
  (`ss.pending` or `ss.mutating`) to it — this is the one permitted hook
  addition, and it is read-only presentation state.
- **Distinct authors:** `new Set(ss.cursors.filter(c => c.sheet_id … present)
  .map(c => c.author))`. Self = `ws.executorPublicKey`. Collaborator bar count
  includes self; footer "peers" excludes self.

---

## Files touched

| File | Change |
|---|---|
| `app/src/index.css` | Retune `:root[data-theme='dark']` tokens; add `--c-chrome` to both themes. |
| `app/src/theme.ts` | Default `getStoredTheme()` to `'dark'`; add `C.chrome`. |
| `app/src/pages/app/AppPage.tsx` | Replace single toolbar with two-tier header; add theme toggle; compute presence/sync; render `StatusBar`. |
| `app/src/components/FormulaBar.tsx` | Dark restyle (styled-components only). |
| `app/src/components/SpreadsheetGrid.tsx` | Dark restyle (styled-components only). |
| `app/src/components/StatusBar.tsx` | **New** — status footer component. |
| `app/src/hooks/useSpreadsheet.ts` | *(If needed)* expose a read-only `pending`/`mutating` flag from the existing mutation queue. |

---

## Testing

- **Unit (vitest):** a `StatusBar` test asserting the three render states —
  `Synced` vs `Syncing…`, peer count text (including `0 peers`), cell count
  text. A small helper test for avatar-initial derivation if that logic is
  extracted to a pure function.
- **Regression:** full `app` suite (97 tests) stays green — the reskin must not
  touch behavior. `tsc` clean, `vite build` succeeds.
- **Manual (local node):** load the app, confirm dark-by-default, header two-tier
  layout, theme toggle flips to light and persists, live pill reflects state,
  avatars appear for real cursors, footer counts track edits. (Deploy path per
  the meroctl memory; frontend-only — no WASM reinstall needed.)

---

## Visual reference

Brainstorm mockups (chosen options): header **B** (two-tier), title layout
**A** (workspace name is the title), footer **A** (sync-forward). Source of
truth for the aesthetic: `LandingPage.tsx` `LivePreview` (window chrome, peer
avatars `#E74C3C`/`#3B82F6`/`#1A7F64`, live/syncing pill, dark grid, status bar).
