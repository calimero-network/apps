# Mero Blocks

## Overview

Mero Blocks is a multiplayer voxel sandbox with no game server: a world is a Calimero context.
A world is 128 x 64 x 128 blocks: x and z in [0, 128), y in [0, 64), y is up.
The contract never stores terrain.
Every client generates identical terrain from the world's seed; the contract stores only the edits made on top of it.

- `world_meta()` returns the world's `name`, `seed` and `createdAt` (unix seconds).
- `get_overrides()` returns every edited coordinate as `{"k": "x,y,z", "b": <block id>}`; `b: 0` means the block was broken.
- `get_players(now)` returns every player row with an `online` flag.

To know what is at a coordinate: an entry in `get_overrides()` for `"x,y,z"` wins; otherwise it is generated terrain, which only a client running the terrain generator can compute.

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
- `join` always places a new player at (0, 0, 0) with `yaw`, `pitch` and `sel` reset to 0; the dry, tree-free spawn column near the world centre (64, 64) is picked by the web client, not the contract, so an agent's player starts at the origin (which may be underground or underwater) until its first `heartbeat`.
- The day/night cycle lasts 600 seconds, counted from `createdAt`.

## Context model

One context is one world, running the bundle's single service.
A world is created with init arguments `name` (string), `seed` (integer) and `now` (the creator's unix seconds).
Each world gets its own namespace and, inside it, its own Open group; the world's context sits in that group, not directly in the namespace. This is the same layout the web client builds, so an agent-made world and a person-made world join the same way: a namespace invitation lets a joiner self-join the Open group by inheritance, then join the context in it.
A player is the calling node's context identity (a device key): one person on two devices is two players.
There are no roles: every member of the world may edit it.

## Getting started

Every app tool (and `call`) takes an `app_handle`. Get one from `select_app` with `app` and `context`; the handle binds the world the call runs against. The JSON examples in this guide show only the method's own arguments.

1. `list_applications` and find the package `com.calimero.mero-blocks`.
2. `create_namespace` with `application` set to that package and `name` set to the world name.
3. `create_group` with `namespace` set to the new namespace id, `name` set to the world name and `visibility: "open"`:

   ```json
   {"namespace": "<namespace id>", "name": "ci", "visibility": "open"}
   ```

   This is the Open group the world's context lives in; `open` is what lets an invited player self-join it later. Keep the returned group id.
4. `create_context` with `application`, `group` set to that group id (the Open group's id from step 3), `name` (the world name) and `args`:

   ```json
   {"application": "com.calimero.mero-blocks", "group": "<group id>", "name": "ci", "args": {"name": "ci", "seed": 42, "now": 1727000000}}
   ```

   Use a seed in [0, 4294967296): the terrain generator reads it as an unsigned 32-bit integer.
5. `select_app` with `app` `com.calimero.mero-blocks` and `context` set to the new context id; keep the returned `app_handle`.
6. Call `join` with a player name and the current unix seconds:

   ```json
   {"name": "bot", "now": 1727000000}
   ```

   This places the player at (0, 0, 0); send a `heartbeat` next to move somewhere else (see Rules and limits).
7. While the player is active, call `heartbeat` every 0.5 seconds while moving and every 2 seconds while idle, as the game does.
   A player silent for more than 10 seconds shows as offline.

To let someone else play, share the namespace id, the group id (from step 3) and the context id, and call `invite_to_namespace` with that namespace id to get the invitation; hand all four to the joiner. See "Join an existing world" below.

## Procedures

### Create a world

Follow Getting started steps 1 to 6, then confirm with `world_meta`:

```json
{}
```

### Join an existing world

On the invitee's node, in this order:

1. `join_namespace` with `namespace` set to the namespace id and `invitation` set to the invitation object exactly as received:

   ```json
   {"namespace": "<namespace id>", "invitation": {"...": "..."}}
   ```

2. `join_open_group` with `group` set to the world's group id, to join the Open group via inheritance:

   ```json
   {"group": "<group id>"}
   ```

3. `join_context` with `context` set to the world's context id:

   ```json
   {"context": "<context id>"}
   ```

4. `select_app` with `app` `com.calimero.mero-blocks` and `context` set to that context id; keep the returned `app_handle`.
5. Call `join` as in Getting started step 6.

### Place or break blocks

Call `set_blocks` with up to 512 edits and the current unix seconds.
Place with a block id from the table; break with `b: 0`.

```json
{"edits": [{"x": 5, "y": 20, "z": 5, "b": 3}, {"x": 6, "y": 20, "z": 5, "b": 0}], "now": 1727000000}
```

It returns how many edits were applied; out-of-bounds edits are skipped, not rejected.
Split a larger build into several calls.

### Read the world's edits

Call `get_overrides` with `{}`.
Each entry is `{"k": "x,y,z", "b": <id>}`, and the list holds every coordinate ever edited, breaks included.
`override_count` with `{}` returns how many coordinates have been edited.

### See who is online

Call `get_players` with the current unix seconds:

```json
{"now": 1727000000}
```

A player is `online` when they have not left and wrote within the last 10 seconds.

### Move a player

Call `heartbeat` with the player's transform:

```json
{"t": {"name": "bot", "x": 64.5, "y": 44.0, "z": 64.5, "yaw": 0.0, "pitch": 0.0, "sel": 0}, "now": 1727000000}
```

Positions are in blocks, `yaw` and `pitch` in radians, `sel` is the hotbar slot (0 to 8).

### Leave a world

Call `leave`:

```json
{"now": 1727000000}
```

The player row stays and shows as offline; a later `join` brings it back at its last position. A later `heartbeat` instead moves the player straight to the position it sends.

## Rules and limits

- Bounds: x and z in [0, 128), y in [0, 64). Out-of-bounds edits are skipped silently and not counted.
- At most 512 edits per `set_blocks` call; more fails the whole call and applies nothing.
- `now` must be real wall-clock unix seconds. It orders concurrent edits of one block (last writer wins) and drives presence.
- Edits are never deleted: breaking writes `b: 0`, so `get_overrides` grows with every coordinate touched.
- Presence: online while the last write is at most 10 seconds old. A player silent for 30 seconds is marked stale, and set to left 30 seconds after that by whichever player calls `set_blocks` or `heartbeat` next.
- `set_blocks` emits `BlocksChanged` only when at least one edit was applied. `join` emits `PlayerJoined`; `leave` emits `PlayerLeft`. `heartbeat` emits `PlayerJoined` only when it creates the row or brings back a player who had left, otherwise no event. Both `set_blocks` and `heartbeat` can also emit `PlayerLeft` for any player they reap for going silent.
- There is no turn order, inventory or win condition: it is a sandbox.
