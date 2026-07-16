# Recipe: per-context metadata (room topic / description)

Attach propagated, human-readable metadata to a **context** (room) — a topic,
description, icon, etc. — that every member reads, without touching the room's
WASM contract. This is the context-level sibling of the workspace-name
propagation the base already does for namespaces (group metadata).

- `setContextMetadata(groupId, contextId, { name, data })` — writes a CRDT
  `MetadataRecord` (`{ name, data, updatedAt, updatedBy }`).
- `getContextMetadata(groupId, contextId)` — reads it back on any node.

`name` is the display title; `data` is a free `Record<string,string>` (topic,
description, emoji…). Use it for room headers/settings. `groupId` is the
room's managing group (the namespace for flat rooms, or the subgroup if you use
the private-rooms recipe — `getContextGroup(contextId)` resolves it).

`useRoomMetadata.ts` is a drop-in hook: `{ meta, setMeta }`.
