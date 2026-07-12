---
title: Architecture
layout: default
nav_order: 2
---

# Architecture

p2p-sheets is a peer-to-peer spreadsheet: there is no server holding the
"real" copy of a workbook. Every peer runs the same logic against the same
replicated data and computes the same answers. Getting that to hold under
concurrent edits is the whole architectural story, and it comes down to one
rule: **only raw inputs are replicated; every computed value is derived,
never stored.**

## Inputs-only CRDT

Each cell in a workbook is a CRDT entry, merged across peers with
last-writer-wins semantics. What that entry holds is deliberately narrow: the
cell's identity (sheet, row, column), its raw content (a literal or a
formula string), and its format — nothing else. In particular, a cell never
stores its *computed* value.

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
