---
title: Architecture
layout: default
nav_order: 2
---

# Architecture

mero-sheets is a peer-to-peer spreadsheet: there is no server holding the
"real" copy of a workbook. Every peer runs the same logic against the same
replicated data and computes the same answers. Getting that to hold under
concurrent edits is the whole architectural story, and it comes down to one
rule: **only raw inputs are replicated; every computed value is derived,
never stored.**

## Inputs-only CRDT

Each cell in a workbook is a CRDT entry, merged across peers with
last-writer-wins semantics. What that entry holds is deliberately narrow: the
cell's identity (sheet, row id, column id) and its raw content (a literal or a
formula string) — nothing else. Its format is a separate last-writer-wins
entry under the same key, so formatting a cell while someone types in it
keeps both. In particular, a cell never stores its *computed* value.

That constraint exists because of what CRDT merge can and can't do here. A
merge is a field-level operation with no hook back into application logic —
there's no way to say "and now recompute everything downstream of this
cell." If a computed value were part of the replicated state, two peers could
each compute a value that was correct against the inputs *they* had at the
time, merge those computed values, and land on a workbook that is internally
inconsistent — a `computed_value` that doesn't match what the merged inputs
actually imply. Keeping computed values out of the CRDT entirely sidesteps
that failure mode by construction: there is nothing derived to merge
incorrectly.

## Rows and columns by id

A cell is keyed by row and column **id**, not position. Each sheet has an
axis of row ids and one of column ids, ordered by fractional position
strings, so inserting or deleting a row is one write to the axis, not a
rewrite of every cell below it, and an edit that races an insert lands on the
cell it was aimed at. Formulas store references by id too (`=SUM(A1:A4)` for
rows that were there from the start, `{r=n…;c=0}` for inserted ones), so they
keep pointing at the same cells; a reference to a deleted row reads `#REF!`.

Every workbook written before ids existed keeps working unchanged: the
original row `k` has id `k` at an implicit position, so an old key or an old
A1 formula already *is* the id form. The app shows and accepts positions; the
engine converts at the edge (`to_display` / `to_stored` in
`logic/crates/recalc`), and places cells with the same layout code the node
evaluates with. See [Recalc engine](recalc) for the formula side.

**The v2 migration** that introduced ids, per-field formats and named ranges
carries every v1 collection over by id and rewrites no cell, so it costs the
same for a workbook of any size: a migration runs as one execution, and
rewriting cells one by one would exhaust its gas budget past a few hundred of
them. It also drops v1's contract-stored cursors, which are ephemeral presence
now.

## Who changed what

Every change is recorded in the workbook itself. Each cell carries its last
editor and time (`cell_meta`), and an activity log (`activity`, a `SortedMap`
keyed by time) holds one entry per change: the author, a summary, and for cell
edits each cell's raw value and format before and after (up to 50 per entry,
with the total). Row/column, sheet and named-range actions are logged too.
Reading "the last two weeks" is an index-backed range seek, so the log's
length does not slow it down. The app shows it as the Activity panel (whole
workbook, or one cell's history) and as "Edited by …" on each cell.

Recording costs one extra write per cell (the editor stamp) and one per call.
That is why a single `apply_cell_ops` call is capped at 100 ops: the costliest
op, a format on an empty cell, fits 160 to one execution's gas budget.

## Comments and mentions

Comments live in the workbook (`comments`, keyed by id) and are pinned to a
cell by its row and column ids, so a thread follows its cell through inserts
and deletes. A reply names its thread's first comment as `parent`; resolving
and reopening is a flag on that first comment. Each comment merges
last-writer-wins on `updated_at`, and only its author may edit or delete it.

`@nickname` in the text is matched against the members' nicknames (longest
first, so "@Ann Lee" beats "@Ann") and the matched member ids are stored with
the comment. `CommentAdded` carries them, so a mentioned member's app shows a
notice straight from the event, with no extra read. The app marks cells with
an open thread and lists every open thread in the Comments panel.

## Cell notes

A note is rich text attached to a cell (`notes`, keyed like `cells`), stored
as the SDK's `RichText`: a sequence CRDT with formatting marks. Two people
typing in the same note both keep their words, and formatting (bold, italic,
underline, strikethrough, highlight) merges the same way. `edit_note` takes
one editor transaction in the Quill delta shape (`retain` / `insert` /
`delete`, formatting as `attributes`); a note's first edit creates it through
`entry().or_default()`, which keys the nested CRDT under the map entry so two
nodes creating the same note at once converge.

A delta counts positions in the note as the sending node holds it. The editor
sends typing a moment after a pause, and before sending it re-reads the note
and rebases the edit over whatever a collaborator changed since
(`spreadsheet/notes.ts`), so text never lands in the wrong place. Notes are
not in the activity log or the undo stack: a note is its own document, edited
continuously.

## Who may do what

Two layers, each enforced where it can be:

- **Workspace access is core's.** A workspace is a namespace (a root group);
  an invitation makes someone a member of it, and so of every spreadsheet in
  it. Core's group roles govern that: an *Admin* manages people, a *Member*
  reads and writes, and *Read only* is refused by every node, both when the
  member executes and when their deltas arrive at peers. Removing a member
  takes them out of every spreadsheet in the workspace and rotates the group
  key: they keep what they already synced and receive nothing written after.
  Their later writes are refused by core ("no owned identity"). The app
  drives this from the People panel through the admin API.
- **Workbook roles and protected ranges are the contract's.** Each member has
  a role in the workbook (`roles`): *owner*, *editor* (the default),
  *commenter* or *viewer*; the creator is the first owner, and a workbook
  made before roles existed can be claimed by any editor. A protected range
  (`protections`) names its corner row and column ids (or none, for a whole
  sheet), so it follows its cells as rows and columns move; only owners and
  the members it lists may change cells inside it, delete rows or columns
  through it, or rename and delete a protected sheet. Every write method
  checks these before touching state, on the node making the change.

The contract check runs on the author's node, so it binds every client that
runs this contract; it cannot stop a node that runs modified code, which is
what core's Read only role is for. Each member's account (`accounts`) is
recorded when they join, which is how the app lines up the contract's
roster, keyed by device, with core's, keyed by account.

## Private sheets

A private sheet is scratch space that never leaves the node: what-if numbers,
drafts, personal views of shared data. It lives in the contract's
`#[app::private]` storage (`Scratch`), which the runtime keeps node-local and
never puts in a delta. The methods that write it take `&mut self` (only
mutating calls commit private writes) and need no role, so even a viewer can
keep one; they produce no delta and emit nothing, so the app reads the private
sheets back after each write instead of waiting for an event.

A private sheet's formulas can read the shared sheets (the app evaluates
private and shared cells together), but a shared cell may not refer to a
private sheet: nobody else could see what it points at, so the app refuses
the write. A private sheet has fixed rows and columns (legacy position ids),
and no comments, notes, protection or named ranges. The app does not publish
your cursor while you are on one. "Private" means this node: another device of
yours does not see it, and anyone who can read this node's storage could.

## The grid

Every sheet is the engine's full layout, 1000 rows by 702 columns (A to ZZ),
and the grid renders only what is on screen: the visible rows and columns
(`spreadsheet/viewport.ts` finds them from the scroll position and each row's
and column's size), with spacers keeping the scroll size true. Frozen rows and
columns are rendered always and stick below the header and beside the row
numbers; their tints are inset shadows over an opaque background, so what
scrolls under them does not show through.

Column widths, row heights and frozen panes are shared workbook state
(`sizes`, keyed like `axes` so a size follows its row or column; `views`, per
sheet), last writer wins, changed by editors and shown optimistically. Private
sheets keep the defaults.

The formula bar holds focus while a cell is selected, so it passes arrows and
Page Up/Down to the grid (Shift extends the selection from where it started,
as does Shift-click), and a typed character replaces the cell's value rather
than appending to it.

## Formatting and rules

A cell has three kinds of presentation, each stored on its own:

- **Number format** (`formats`): `number:2`, `currency:EUR:0`, `percent:1`,
  `date:us`, `text`, … (`spreadsheet/format.ts`). One value per cell.
- **Style** (`styles`): bold, italic, underline, strikethrough, wrap, text
  and fill colour, alignment. Each field is its own last-writer-wins value
  inside one entry per cell, so one person bolding a cell and another
  colouring it both keep their change.
- **Rules** (`rules`), over a range anchored on corner row and column ids:
  a conditional format (style the cells that meet a condition; the first
  matching rule wins a field), a colour scale (shade numbers between two
  colours), or a validation (values must meet a condition). A validation is
  strict (the contract refuses a literal value that breaks it, naming what it
  must be) or loose (the app marks the cell). A checkbox validation draws a
  checkbox; a list validation offers its choices.

Conditions are evaluated by one function in the engine crate
(`crates/recalc/src/rules.rs`): the contract calls it for strict validations,
and the browser calls the same code through `recalc-wasm` to colour and mark
cells, so the two never disagree about what a rule means. Formulas are not
validated on write, since their value is not known there; the app still marks
a formula result that breaks a rule.

## Sort, filter and charts

- **Sort** rewrites the range's cells: each row's cells move together, a
  moved formula shifts its relative references by the rows it moved (as a
  copy would), and styles travel with their rows. Blanks sort last; numbers
  before text; ties keep their order. With one cell selected, the range is
  the block of data around it, and a text first row over numbers is kept as
  the header (`spreadsheet/sort.ts`). It is ordinary cell writes, so it
  merges, logs and undoes like any edit.
- **Filter views** are personal: kept in this browser per workbook and
  sheet, never written to the workbook, so filtering to "my rows" changes
  nothing for anyone else. Hidden rows take no height in the grid.
- **Charts** are shared (`charts`, anchored on corner ids like rules): bars
  or lines, the range's first column labelling the points and each other
  column a series. They are drawn live from the sheet's values, in the
  categorical palette's fixed order (up to eight series, checked for
  colour-vision separation against the app's light and dark surfaces), with
  a legend, a hover tooltip and a table of the same numbers.

## Files in and out

- **Import** turns an `.xlsx` (every worksheet) or a `.csv`/`.tsv` (one
  sheet; RFC 4180 quoting, delimiter guessed) into new sheets. Sheets are
  made first, so imported formulas that name another imported sheet resolve;
  values and formulas are written as ordinary cell writes. Excel's shared
  formulas are re-based cell by cell. Cells past row 1000 or column ZZ are
  left out, and the app says how many.
- **Export** writes the shared sheets as CSV (values as shown) or `.xlsx`
  (values and formulas with sheet names, plus each formula's last value so a
  reader that does not recalculate still shows it). Styles and number
  formats are not carried either way. Both are built in the browser
  (`spreadsheet/xlsx.ts` on fflate, `spreadsheet/csv.ts`).
- **Attachments**: a file on a cell is a blob uploaded to the node and
  announced to this context, so members' nodes can fetch it from peers; the
  contract records its name, size, type and who attached it
  (`attachments`). Whoever attached a file, or an owner, can remove it.

## Linked workbooks and automations

Workbooks in one workspace can share data without merging: a **link** sends
a range of one workbook to another, where it appears as a read-only sheet
(`⇆`) that formulas can use like any other (`=Rates!B1*2`).

- The source records the link (`publications`) and pushes the range's
  computed values with a cross-context call: `env::xcall` to the target's
  `receive_link`, which the node runs after the source's call commits. The
  entry point is `#[app::xcall(from_same_app)]`, so only this same app can
  reach it, and it checks that the node-set origin is the workbook the call
  names; a direct call is refused.
- The target keeps the values (`linked`, one entry per link, at most 2000
  cells) and serves them as a sheet: they join the cells formulas read, so
  its formulas compute on the node and in the browser alike. Its own editors
  can remove a linked sheet, after which later pushes are ignored; the
  source can stop a link, which removes the sheet there.
- **Automation:** a link is pushed again whenever a cell on its sheet changes
  (and on demand). An **alert** rule tells chosen members when a value in
  its range starts meeting a condition, formulas included: the contract
  evaluates the sheet after each change and emits `AlertTriggered` for cells
  that newly match (`alert_state` remembers which already did), and each
  recipient's app shows it. Both cost nothing on sheets without links or
  alerts.

xcall runs on the node making the change, against a workbook that node has
opened; a workbook this node has never opened does not receive the push
until it is opened and the source pushes again.

## Sync status and always-on replicas

The status bar reports sync from the node's own signals rather than a guess:
whether the browser reaches the node (the event stream's connect/error),
whether a write is in flight, and the node's `SyncStatus` events for this
workbook — up to date, waiting for a peer, syncing (with snapshot progress),
or retrying after a failure with its reason (`spreadsheet/sync.ts`).

A workbook is only reachable while some member's node is online. To keep it
available when everyone's laptop is closed, an owner can admit **always-on
replicas** from People: the workspace's TEE admission policy names the
attested build (MRTD) and TCB status a node must present; such a node joins
as a read-only replica, holds the state, and serves it to members who come
online later. It cannot write, so it adds availability without adding an
editor.

## Derive-on-read

If values aren't stored, they have to be produced somehow when a peer asks
to see a sheet. That happens on every read: given the current merged set of
raw inputs, the engine builds a dependency graph (which cells reference
which other cells), performs a topological sort over that graph, and
evaluates each cell once, in dependency order, using its precedents' already
-computed values. A cell that can't be placed in the sort — because it sits
on or downstream of a circular reference — is reported as an error rather
than evaluated.

This has two useful properties. First, correctness under collaboration is
free: because every peer runs the identical deterministic evaluation over
whatever inputs have merged in locally, two peers with the same merged
inputs always compute the same outputs, with no reconciliation step needed.
Second, cycle detection stops being a heuristic. A single pass over a graph
that is provably acyclic (by the sort having succeeded) cannot loop forever,
so the evaluator terminates by construction rather than by an iteration
cap — a meaningful property on a runtime with no execution-time metering.

The trade-off is that reads now do the work that writes used to do. Writes,
by contrast, become cheap: storing a raw value is an O(1) operation, with no
recomputation triggered at write time at all.

## The p2p substrate: contexts and namespaces

Replication is provided by Calimero's group-context model. Each workbook
lives inside its own context — a namespace that a set of peers join and
which Calimero keeps synchronized between them as a CRDT. There is no
central server brokering that synchronization; peers exchange updates
directly, and a workbook is "live" for as long as at least one peer holding
its context is reachable. Joining a workbook means joining its context;
leaving means the local replica stops receiving updates but keeps whatever
state it last saw.

## The `app/` ↔ `logic/` split

The system divides cleanly along the client/node boundary. `logic/` is a
Rust workspace that compiles to a WASM application bundle and runs inside a
merod node — it owns the replicated state, applies writes, and can derive
computed values on request via the same evaluator described above. `app/` is
the React client: it talks to a merod node over Calimero's JS SDK to read
and write cells, and separately loads a WASM build of the same evaluation
engine so it can derive values itself, in-browser, for instant local echo
without waiting on a round trip. Both sides run the same pure evaluation
logic — one compiled for the node, one compiled for the browser — so they
agree by construction rather than by any synchronization protocol between
the two engines themselves.

## Runtime dependency on a node

Because the client relies on a merod node to hold and replicate context
state, the app is not self-contained: a browser tab with no reachable node
has nothing to read from and nowhere to write to. A deployed client (for
example, the Vercel-hosted build) is only useful once it can reach a merod
node — locally, on a LAN, or wherever peers have chosen to run one. This is
a deliberate consequence of being peer-to-peer rather than server-backed:
there is no fallback central service to talk to if no node is reachable.
