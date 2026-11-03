# Recipe: authored feed (a `Vector` with an `author` field)

An **append-ordered, author-owned** log (activity feeds, posts, event logs).
v1 used `AuthoredVector<T>`, whose store refused anyone but the pusher at
merge time. On Calimero 1.0 every write is a method run by the app's leader, so:

- `post(text) -> index`: appends; the author is `env::caller()`'s account.
- `editPost(index, text)` / `deletePost(index)`: refused (`NotAuthor`) for
  anyone but the author; delete leaves a tombstone so indexes stay put.
- `getFeed(offset, limit)`: insertion order, tombstones skipped, at most 1,000
  positions read; `feedLen()`: a stored count.

`feed.rs` is a complete app module (state, methods, error, events). From a
frontend: `client.call(app, 'post', { text })`,
`client.view(app, 'getFeed', { offset: '0', limit: '50' })` (u64 arguments are
decimal strings).
