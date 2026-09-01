# Recipe: public / private rooms (subgroups + visibility)

**Problem the base has:** rooms are contexts created in the namespace ROOT group
with auto-join, so *every* workspace member is in *every* room — there's no
per-room membership or privacy.

**This recipe:** model each room as a **subgroup** whose `visibility` decides
access:

- `'open'` → **public**: any workspace member can self-join (needs the
  `CAN_JOIN_OPEN_SUBGROUPS` capability, set in the namespace defaults).
- `'restricted'` → **private**: only members the creator/admin explicitly adds.

```
namespace (workspace)
├── subgroup "general"  open        → context  (everyone can join)
└── subgroup "founders" restricted  → context  (only added members)
```

## Swap it into the base

In `useChatLobby.ts` / `ChatPage.tsx`, replace the flat
`createContext({ groupId: namespaceId })` room-creation with the subgroup flow
in `useSubgroupRooms.ts`:

1. `createGroupInNamespace(namespaceId, { name })` → `subgroupId`
2. `setSubgroupVisibility(subgroupId, { subgroupVisibility })`
3. `createContext({ groupId: subgroupId, serviceName: 'room', ... })`
4. private only: `addGroupMembers(subgroupId, { members })`

List rooms with `listSubgroups(namespaceId)` (the node only returns restricted
subgroups the caller may see) + `getGroupInfo(id)` for visibility, and join with
`joinContext(contextId)` (open) or after being added (restricted).

Add a **public/private toggle** to `CreateRoomModal` and bring back the member
picker — now it *actually* gates membership.

Set the namespace default capability `CAN_JOIN_OPEN_SUBGROUPS` (bit `1<<2`) in
`useNamespaceBootstrap` so members can self-join public rooms.

See the `calimero-client-js` skill `subgroups-and-visibility.md` for the full API
+ gotchas. `useSubgroupRooms.ts` here is a drop-in hook.
