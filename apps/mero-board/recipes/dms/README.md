# Recipe: direct messages (2-person private subgroup)

A DM is just the **private-rooms** pattern with exactly two members and a marker
so the UI can render it as a 1:1 chat instead of a room. Reuses the same room
context/service — no new contract needed.

- Create a **restricted** subgroup, add the other member, create the room
  context inside it.
- Mark it as a DM via group **metadata** (`data: { dm: '1', a, b }`) so DM
  discovery can filter subgroups and resolve the "other" participant.
- A DM between A and B is deterministic: sort the two identities so both sides
  derive the same DM and you don't create duplicates.

Depends on `../private-rooms`. `useDms.ts` is a drop-in hook: `openDm(other)` +
`dms` list. Pair it with the base's `RoomView` to render the conversation.
