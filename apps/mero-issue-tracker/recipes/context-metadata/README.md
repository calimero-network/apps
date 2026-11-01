# Recipe: room metadata (topic / description)

Attach human-readable metadata to a **room** (an app instance): a title, a
topic, an icon, that every member reads, without touching the room's
contract. v1 kept this as context metadata on the managing group; on
Calimero 1.0 an app instance carries its own metadata.

- `client.setAppMetadata(appId, { name, data })`: the app's owner or an admin
  of its organization; at most 16 KiB of JSON.
- `(await client.getApp(appId)).metadata`: read by anyone the app reaches.

`useRoomMetadata.ts` is a drop-in hook: `{ meta, setMeta }`.
