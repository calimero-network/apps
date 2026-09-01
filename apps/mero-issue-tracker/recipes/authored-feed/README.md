# Recipe: authored feed (`AuthoredVector<T>`)

The base stores messages in `AuthoredMap<String, Message>` — author-owned but
**hash-ordered**, so it sorts by `(timestamp, id)` on every read. When you want
an **append-ordered, author-owned** log (activity feeds, comments, posts,
event logs), use `AuthoredVector<T>`:

- `push(value) -> index` — appends; the pusher becomes the entry's **author**.
- `update(i, value)` / `tombstone(i)` — **only the author** may edit/remove (the
  store rejects others at merge time, like AuthoredMap).
- `iter()` — entries in insertion order; `owner_of(i)` / `len()`.

So you get free per-entry authorship + chronological order without manual
sorting. `feed.rs` is a reference `#[app::state]` + methods — drop the field into
a service's state and the methods into its `#[app::logic]` impl, then rebuild
WASM + regenerate the client.

Frontend usage mirrors the base's generated client:
`await client.post({ body })`, `await client.getFeed({ offset, limit })`.
