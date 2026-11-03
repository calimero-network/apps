# Recipe: direct messages (an app instance for two accounts)

A DM is a room reachable by exactly two accounts: an app instance in the
organization whose access is `{ kind: 'accounts', accounts: [a, b] }` (the
owner, who creates it, is one of them). No team and no new contract: it reuses
the room's.

- Mark it as a DM in its **app metadata** (`{ dm: true, a, b }`) so the UI can
  render it as a 1:1 chat and find "the other" participant.
- Deterministic: sort the two account ids so both sides look for the same DM
  and never create a duplicate.

`useDms.ts` is a drop-in hook: `openDm(other)` + the `dms` list.
