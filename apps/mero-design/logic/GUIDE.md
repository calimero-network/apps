# MeroDesign

## Overview

MeroDesign is a collaborative, Figma-style design canvas.
A board holds elements (shapes, lines, paths, text, images, SVGs), members, comments and live pointers.

- `get_board()` returns the board's `name`, `description`, `elementCount`, `memberCount` and `owner`.
- `get_elements()` returns every element in paint order (lowest `layerIndex` first).
- `get_members()`, `list_roles()`, `get_comments()` and `get_cursors()` return the rest of the board.

Coordinates are canvas pixels: `x` and `y` are an element's top-left corner, and `rotation` is in degrees.
Colours are CSS colours (`"#ef4444"`, `"transparent"`, `"rgba(0,0,0,0.3)"`).
`opacity` is a percentage from 0 to 100.
Timestamps (`timestamp`, `created_at`, `updated_at`) are the caller's clock in unix milliseconds.
Element, comment and reply ids are chosen by the caller; use a fresh UUID for each.
Element keys are camelCase (`strokeWidth`, `layerIndex`, `updatedAt`), as the method schema shows; method arguments are snake_case.

An element's `data` says what it is, tagged by `kind`:

| kind | extra `data` fields |
| ---- | ------------------- |
| `rect`, `circle` | none |
| `line`, `arrow` | `points`: `"x1,y1 x2,y2"` in pixels from the element's `x`, `y`; an arrow's head is at the second point |
| `path` | `points`: SVG path data, e.g. `"M 0 0 L 40 40"` |
| `text` | `content`, `fontSize`, `fontFamily`, `bold`, `italic`, optional `text_align` (`left`, `center`, `right`) and `vertical_align` (`top`, `middle`, `bottom`) |
| `image`, `svg` | `naturalWidth`, `naturalHeight`, `blobId` (a blob uploaded to the node) |

A plain `text` element is coloured by its `fill`.

### Labels

An element's `label` is its layer name, a `/`-separated path: everything before the last segment is its group, the last segment is its name (`topbar/logo`).
A `rect` labelled exactly `screen/<name>` is a presentation screen: everything painted inside it is one slide.
A screen whose name ends in ` @<n>` (`screen/Home @2`) has a fixed place: numbered screens play first, by number, and the rest follow in reading order (rows top to bottom, left to right).

A label may also carry the web client's per-element extras after a U+001F character (`\u001f` in JSON), as URL-encoded `key=value` pairs joined by `&`:

| key | meaning |
| --- | ------- |
| `b` | `sticky` or `box`: a `text` element drawn as a sticky note or a text box, whose `fill` is the background |
| `c` | text colour inside a sticky or box |
| `h` | `triangle`, `diamond`, `star` or `cloud`: a `path` redrawn as that shape at any size |
| `s` | outline style: `dashed`, `dotted`, `dashdot`, `dotted3` or `long` |
| `f`, `t` | a line or arrow docked to a shape: `<element id>:<top|right|bottom|left>` for its start and end |

For example, `"Todo\u001fb=sticky"` is a sticky note named `Todo`, and `"\u001fh=star"` is an unnamed star.
When renaming, keep everything from the U+001F on, or the element loses its extras.

## Context model

One context is one board (the web app calls it a project), running the bundle's single service.
Boards belong to a team, which is a namespace; each board gets its own Open group inside the team, and the board's context lives in that group.
A board is created with init arguments `name` and `description`.
The creator becomes the board's owner and its only admin.

Members, roles and ownership belong to accounts: a member id is a 64-hex account id, the same id `list_group_members` shows.
One person on two devices is one member with two pointers.

Roles:

- admin: everything an editor can do, plus granting and revoking the editor role and clearing the board; the owner is an admin.
- editor: may add, change and delete elements and comments.
- viewer: everyone else, read-only, though anyone in the context may still `join`, rename themselves and move their pointer.

## Getting started

Every app tool (and `call`) takes an `app_handle`.
Get one from `select_app` with `app` and `context`; the handle binds the board the call runs against.
The JSON examples in this guide show only the method's own arguments.

1. `list_applications` and find the package `com.calimero.mero-design`.
2. Reuse the team's namespace (`list_namespaces`), or `create_namespace` with `application` set to the package and `name` set to the team name.
3. `create_group` with `namespace` set to the team's namespace id, `name` set to the board name and `visibility` `open`:

   ```json
   {"namespace": "<namespace id>", "name": "Landing page", "visibility": "open"}
   ```

   Keep the returned group id; `open` is what lets team members join the board later.
4. `create_context` with `application`, `group` set to that group id, `name` (the board name) and `args`:

   ```json
   {"application": "com.calimero.mero-design", "group": "<group id>", "name": "Landing page", "args": {"name": "Landing page", "description": ""}}
   ```

   If the response is lost, look for the board with `list_contexts` before retrying, or you get a second board.

5. `select_app` with `app` `com.calimero.mero-design` and `context` set to the new context id; keep the returned `app_handle`.
6. Call `join` so other members see a name for you:

   ```json
   {"username": "bot", "avatar": null, "timestamp": 1727000000000}
   ```

To find an existing board, `list_contexts` with `application` `com.calimero.mero-design`.
Each entry's `name` is the board's name at creation and its `groupId` is the board's group; `get_board` gives the current name.

## Procedures

### Invite someone to a board

1. As the inviter, `invite_to_namespace` with the team's namespace id, and hand the invitation, the namespace id, the board's group id and its context id to the invitee.
2. On the invitee's node: `join_namespace` with `namespace` and `invitation` exactly as received, then `join_open_group` with the group id, then `join_context` with the context id.
3. The invitee runs `select_app` with that context and calls `join`.

A new member is a viewer until an admin grants the editor role (see "Share editing rights").

### Add a shape

As an editor, call `add_element`:

```json
{"element": {"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "data": {"kind": "rect"}, "x": 40, "y": 60, "width": 120, "height": 80, "rotation": 0, "fill": "#ef4444", "stroke": "transparent", "strokeWidth": 0, "opacity": 100, "layerIndex": 0, "createdBy": "", "createdAt": 1727000000000, "updatedAt": 1727000000000}}
```

Give each new element a `layerIndex` one above the highest in `get_elements` so it paints on top.
`createdBy` is required but ignored; the contract records the caller.
For a triangle, diamond, star or cloud, add a `path` whose `points` outline the shape inside its box and label it `"\u001fh=<shape>"`.

### Add text or a sticky note

```json
{"element": {"id": "0d6f3a52-1b7e-4c9a-8e2d-5a4b3c2d1e0f", "data": {"kind": "text", "content": "Hello", "fontSize": 24, "fontFamily": "sans-serif", "bold": false, "italic": false}, "x": 40, "y": 200, "width": 200, "height": 36, "rotation": 0, "fill": "#111111", "stroke": "transparent", "strokeWidth": 0, "opacity": 100, "layerIndex": 1, "createdBy": "", "createdAt": 1727000000000, "updatedAt": 1727000000000}}
```

A sticky note is a 200 x 200 `text` element with `text_align` `left`, `vertical_align` `top`, a `fill` such as `#FFE27A` and `label` `"\u001fb=sticky"`.

Change text later with `update_text_style`; `null` leaves a field unchanged:

```json
{"id": "0d6f3a52-1b7e-4c9a-8e2d-5a4b3c2d1e0f", "content": "Hello there", "font_family": null, "font_size": 32, "bold": true, "italic": null, "text_align": "center", "vertical_align": null, "updated_at": 1727000005000}
```

### Add an image

`upload_blob` the image bytes (base64) with `context` set to the board's context id, then `add_element` with `data` `{"kind": "image", "naturalWidth": 800, "naturalHeight": 600, "blobId": "<blob id>"}` (`svg` works the same).
The contract announces the blob to the board's members.

### Move, resize or restyle an element

Call `update_element` with only the fields to change and a newer `updated_at`:

```json
{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "x": 300, "y": 60, "width": null, "height": null, "rotation": null, "fill": "#22c55e", "stroke": null, "stroke_width": null, "opacity": null, "corner_radius": 8, "updated_at": 1727000010000}
```

`update_shadow` sets all four shadow fields at once (all `null` removes the shadow), and `update_element_label` renames the layer.

### Work on many elements at once

`add_elements`, `update_elements`, `update_element_labels` and `delete_elements` each do a whole selection in one call:

```json
{"patches": [{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "x": 40, "y": 50}], "updated_at": 1727000010000}
```

```json
{"ids": ["5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"]}
```

`add_elements` returns the ids in order; the update batches skip unknown ids.
`get_elements_by_ids` reads a list of ids back in one call.

### Reorder layers

`bring_to_front` or `send_to_back` with `{"id": "<element id>"}`, or `set_layer_index` to put one element at an exact position (0 is the back):

```json
{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "index": 0, "updated_at": 1727000020000}
```

### Group layers or make a presentation screen

Group by giving elements labels with the same prefix (`update_element_labels` with `topbar/logo`, `topbar/menu`).
For a screen, add a `rect` covering the slide area, then label it:

```json
{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "label": "screen/01 Sign in", "updated_at": 1727000030000}
```

### Comment

`add_comment` pins a comment at a canvas point; `add_reply` answers it:

```json
{"id": "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d", "x": 120, "y": 90, "content": "Bigger logo?", "created_at": 1727000040000}
```

```json
{"comment_id": "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d", "reply_id": "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", "content": "Agreed", "created_at": 1727000050000}
```

`delete_reply` and `delete_comment` remove them.
Editing a comment's text is not supported: delete it and add a new one.

### Share editing rights

As an admin, take the member id from `get_members`, `list_roles` or `list_group_members` on the board's group, and call `grant_editor`:

```json
{"member": "<member id>"}
```

The person does not need to have opened the board yet.
`revoke_editor` takes the same argument.
`get_role` with a member id, or `my_role` with `{}`, reads a role.

### Rename the board or hand it over

As the owner, `update_board` renames it (`null` leaves a field unchanged):

```json
{"name": "Landing page v2", "description": null}
```

`transfer_ownership` with `{"new_owner": "<member id>"}` makes that account owner and admin, and removes the caller's admin role, so the caller can no longer edit unless granted editor.
This only changes the board's own roles; the context's name and the team are unchanged.

## Rules and limits

- Only admins and editors may change elements or comments; viewers get `view-only: editor or admin access is required to modify this board`.
- `update_board` and `transfer_ownership` are owner-only.
- `grant_editor`, `revoke_editor`, `clear_elements` and `clear_comments` are admin-only.
- `clear_elements`, `clear_comments`, `delete_element`, `delete_elements`, `delete_comment` and `delete_reply` delete for every member and cannot be undone.
- `delete_context` on a board's context, run by an admin of the board's group (its creator), deletes the whole board for the team, as the web app's Delete project does, and cannot be undone.
- An element is replaced as a whole by the write with the larger `updatedAt`, so always send an `updated_at` newer than the element's current one.
- `add_element` or `add_comment` with an existing id replaces that element or comment, so a retried add is safe.
- An unknown element id is not an error, and `add_reply` to an unknown comment silently does nothing.
- Check `get_element` before updating or reordering an element you did not just add.
- A batch call holds at most 200 items; over that the whole call is refused and nothing changes.
- `delete_elements` can run out of gas before 200 on a large board (about 23 ids at 1000 elements); nothing is deleted then, so halve the batch and retry.
- `/` is reserved inside a layer name: it separates groups.
- An empty board name or description in `update_board` shows the one given at creation.
