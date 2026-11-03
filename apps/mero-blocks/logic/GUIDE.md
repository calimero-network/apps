# Mero Blocks

## Overview

Mero Blocks is a multiplayer voxel sandbox with no game server: a world is a Calimero app instance.
A world is 128 x 64 x 128 blocks: x and z in [0, 128), y in [0, 64), y is up.
The contract never stores terrain.
Every client generates identical terrain from the world's seed; the contract stores only the edits made on top of it.

- `worldMeta` returns the world's `name`, `seed` and `createdAt` (unix seconds); `seed` and `createdAt` are decimal strings.
- `getOverrides` returns the edited coordinates, a page at a time, as `{"items": [{"k": "x,y,z", "b": <block id>}], "next": <cursor or null>}`; `b: 0` means the block was broken.
- `getPlayers` returns the player rows with an `online` flag, a page at a time, as `{"items": [...], "next": <cursor or null>}`.
- A paged read answers at most 1,000 rows (pass `limit` for fewer). Call it again with `cursor` set to `next` until `next` is `null`.

Method and argument names are camelCase. Every `u64` (`now`, `seed`, `createdAt`) is a decimal string on the wire: send `"now": "1727000000"`, not a number.

To know what is at a coordinate: an entry in `getOverrides` for `"x,y,z"` wins; otherwise it is generated terrain, which only a client running the terrain generator can compute.

Block ids the client defines for `b`; the contract stores any 0-255 value without checking it, so never send one outside this table:

| id | block | id | block |
| -- | ----- | -- | ----- |
| 0 | air (use to break) | 8 | plank |
| 1 | grass | 9 | glass |
| 2 | dirt | 10 | brick |
| 3 | stone | 11 | torch (light 14) |
| 4 | sand | 12 | glowstone (light 15) |
| 5 | water | 13 | bedrock |
| 6 | wood | 14 | cobble |
| 7 | leaves | 15 | snow |

Air, water and torch do not block movement.
The game never lets a player break air or bedrock; the contract accepts any edit, so do not overwrite the bedrock floor at y = 0.

Terrain, for placing blocks where players will see them:

- y = 0 is bedrock everywhere.
- The ground surface lies between y = 12 and y = 41, and water fills every column up to y = 22 (sea level).
- The top block is sand at or below y = 23, snow at y = 38 and above, grass otherwise; dirt sits under it and stone below that.
- `join` places a new player at (0, 0, 0) with `yaw`, `pitch` and `sel` reset to 0; the dry, tree-free spawn column near the world centre (64, 64) is picked by the web client, not the contract, so an agent's player starts at the origin (which may be underground or underwater) until its first `heartbeat`.
- The day/night cycle lasts 600 seconds, counted from `createdAt`.

## World model

One app instance is one world. The web client creates each world in an organization of its own, so its creator can invite players: an invitation is an org membership, and every member, admin and guest of the org may play.
A world is created with optional init arguments `name` (string), `seed` (a decimal string in [0, 4294967296)) and `now` (the creator's unix seconds, a decimal string); left out, they default to `"overworld"`, a random seed and the cluster's clock.
A player is the calling account, plus an optional `device` label (1 to 64 of `A-Za-z0-9_-`) the caller picks, so one person on two devices is two players. A player's `id` is the account, or `"<account>/<device>"`. An account holds at most 8 players.
There are no roles: every member of the world may edit it. An account only ever writes its own player rows.

## Getting started

1. Create an organization for the world (its name is the world's name) and keep its id.
2. Create an app instance of the package `com.calimero.mero-blocks` in that organization, with init arguments:

   ```json
   {"name": "ci", "seed": "42", "now": "1727000000"}
   ```

3. Call `join` with a player name and the current unix seconds:

   ```json
   {"name": "bot", "now": "1727000000"}
   ```

   This places the player at (0, 0, 0); send a `heartbeat` next to move somewhere else.
4. While the player is active, call `heartbeat` every 0.5 seconds while moving and every 2 seconds while idle, as the game does.
   A player silent for more than 10 seconds shows as offline.

To let someone else play, invite them into the world's organization as a member and hand them the invitation token; they redeem it, then find the world among the app instances they reach.

## Procedures

### Place or break blocks

Call `setBlocks` with up to 512 edits and the current unix seconds.
Place with a block id from the table; break with `b: 0`.

```json
{"edits": [{"x": 5, "y": 20, "z": 5, "b": 3}, {"x": 6, "y": 20, "z": 5, "b": 0}], "now": "1727000000"}
```

It returns how many edits were applied; out-of-bounds edits are skipped, not rejected.
Split a larger build into several calls.

### Read the world's edits

Call `getOverrides` with `{}`, then again with `{"cursor": "<next>"}` while `next` is not `null`.
Each entry in `items` is `{"k": "x,y,z", "b": <id>}`; together the pages hold every coordinate ever edited, breaks included.
`overrideCount` with `{}` returns how many coordinates have been edited.

### See who is online

Call `getPlayers` with the current unix seconds:

```json
{"now": "1727000000"}
```

Follow `next` as for `getOverrides` (add `"cursor"` beside `"now"`). A player is `online` when they have not left and wrote within the last 10 seconds.

### Move a player

Call `heartbeat` with the player's transform:

```json
{"t": {"name": "bot", "x": 64.5, "y": 44.0, "z": 64.5, "yaw": 0.0, "pitch": 0.0, "sel": 0}, "now": "1727000000"}
```

Positions are in blocks, `yaw` and `pitch` in radians, `sel` is the hotbar slot (0 to 8). Pass the same `device` you joined with, if any.

### Leave a world

Call `leave`:

```json
{"now": "1727000000"}
```

The player row stays and shows as offline; a later `join` brings it back at its last position. A later `heartbeat` instead moves the player straight to the position it sends.

## Rules and limits

- Bounds: x and z in [0, 128), y in [0, 64). Out-of-bounds edits are skipped silently and not counted.
- At most 512 edits per `setBlocks` call; more fails the whole call with `TooManyEdits` and applies nothing.
- `now` must be real wall-clock unix seconds. It drives presence; the cluster orders edits (the later call wins).
- Edits are never deleted: breaking writes `b: 0`, so `getOverrides` grows with every coordinate touched.
- Presence: online while the last write is at most 10 seconds old. Nothing sets a silent player to left automatically; they simply show as offline until they call `leave`, or come back online on their next `heartbeat`.
- `setBlocks` emits `BlocksChanged {id}` only when at least one edit was applied. `join` emits `PlayerJoined {id}`; `leave` emits `PlayerLeft {id}`. `heartbeat` emits `PlayerJoined` only when it creates the row or brings back a player who had left, otherwise no event.
- There is no turn order, inventory or win condition: it is a sandbox.
