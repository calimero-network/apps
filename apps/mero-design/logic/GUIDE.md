# MeroDesign

## Overview

MeroDesign is a collaborative, Figma-style design canvas.
A board holds elements (shapes, lines, paths, text, images, SVGs), members, comments and live cursors.

- `get_board()` returns the board's `name`, `description`, `elementCount`, `memberCount` and `owner`.
- `get_elements()` returns every element in paint order (lowest `layerIndex` first).
- `get_members()`, `get_comments()` and `get_cursors()` return the rest of the board.

Coordinates are canvas pixels, `x` and `y` are an element's top-left corner, and `rotation` is in degrees.
`opacity` is a percentage from 0 to 100.
Timestamps (`timestamp`, `created_at`, `updated_at`) are the caller's clock in unix milliseconds.
Element, comment and reply ids are chosen by the caller; use a fresh UUID for each. Element keys are camelCase (`strokeWidth`, `layerIndex`, `updatedAt`), as the method schema shows.

An element's `data` says what it is, tagged by `kind`:

| kind | extra `data` fields |
| ---- | ------------------- |
| `rect`, `circle` | none |
| `line`, `arrow` | `points`: `"x1,y1 x2,y2"` in element-local pixels |
| `path` | `points`: SVG path data, e.g. `"M 0 0 L 40 40"` |
| `text` | `content`, `fontSize`, `fontFamily`, `bold`, `italic`, optional `text_align` (`left`, `center`, `right`) and `vertical_align` |
| `image`, `svg` | `naturalWidth`, `naturalHeight`, `blobId` (a blob uploaded to the node) |

Layer names are element labels. A label is a `/`-separated path: everything before the last segment is the group, the last segment is the layer's name (`topbar/logo`).
A rectangle labelled `screen/<name>` directly under `screen` is a presentation screen (one slide); a trailing ` @<n>` on its name fixes its place in the play order.

## Context model

One context is one board (the app calls it a project), running the bundle's single service.
A board lives inside a team, which is a namespace; the app gives each board its own Open group inside the team.
A board is created with init arguments `name` and `description`.
The creator becomes the board's owner and its only admin.

Roles:

- admin: may edit, grant and revoke the editor role, and clear the board. The owner is an admin.
- editor: may add, change and delete elements and comments.
- viewer: everyone else, read-only. Every member may still `join`, rename themselves and move their cursor.

Roles and ownership belong to accounts. Board members are identified by member ids (device keys, 64 hex); a member's account becomes known to the board only once that member has called `join` or `update_cursor`.

## Getting started

Every app tool (and `call`) takes an `app_handle`. Get one from `select_app` with `app` and `context`; the handle binds the board the call runs against. The JSON examples in this guide show only the method's own arguments.

1. `list_applications` and find the package `com.calimero.mero-design`.
2. `list_namespaces`; reuse the team's namespace or `create_namespace` with `application` set to the package and `name` set to the team name.
3. `create_group` with `namespace` set to the team's namespace id, `name` set to the board name and `visibility` `open`.
4. `create_context` with `application`, `namespace` set to the new group id, `name` (the board name) and `args`:

   ```json
   {"name": "Landing page", "description": ""}
   ```

5. `select_app` with `app` `com.calimero.mero-design` and `context` set to the new context id; keep the returned `app_handle`.
6. Call `join` to register as a member:

   ```json
   {"username": "bot", "avatar": null, "timestamp": 1727000000000}
   ```

To invite someone, `invite_to_namespace` for the team and hand over the invitation.
They run `join_namespace` on their node, `join_open_group` with the board's group id, `join_context` with the board's context id, `select_app` with it, then call `join`.
Only after that can an admin grant them the editor role.

## Procedures

### Add a shape

As an editor, call `add_element`:

```json
{"element": {"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "data": {"kind": "rect"}, "x": 40, "y": 60, "width": 120, "height": 80, "rotation": 0, "fill": "#ef4444", "stroke": "transparent", "strokeWidth": 0, "opacity": 100, "layerIndex": 0, "createdBy": "", "createdAt": 1727000000000, "updatedAt": 1727000000000}}
```

Give each new element a `layerIndex` one above the highest in `get_elements` so it paints on top.

### Add text

```json
{"element": {"id": "0d6f3a52-1b7e-4c9a-8e2d-5a4b3c2d1e0f", "data": {"kind": "text", "content": "Hello", "fontSize": 24, "fontFamily": "sans-serif", "bold": false, "italic": false}, "x": 40, "y": 200, "width": 200, "height": 36, "rotation": 0, "fill": "#111111", "stroke": "transparent", "strokeWidth": 0, "opacity": 100, "layerIndex": 1, "createdBy": "", "createdAt": 1727000000000, "updatedAt": 1727000000000}}
```

Change text later with `update_text_style`; `null` leaves a field unchanged:

```json
{"id": "0d6f3a52-1b7e-4c9a-8e2d-5a4b3c2d1e0f", "content": "Hello there", "font_family": null, "font_size": 32, "bold": true, "italic": null, "text_align": "center", "vertical_align": null, "updated_at": 1727000005000}
```

### Batch operations

Editing many elements at once (a paste, a multi-select drag, a bulk delete) is one call instead of one per element.

`add_elements` adds a whole selection and returns every new id, in order:

```json
{"elements": [{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "data": {"kind": "rect"}, "x": 40, "y": 60, "width": 120, "height": 80, "rotation": 0, "fill": "#ef4444", "stroke": "transparent", "strokeWidth": 0, "opacity": 100, "layerIndex": 0, "createdBy": "", "createdAt": 1727000000000, "updatedAt": 1727000000000}]}
```

`update_elements` applies one `updated_at` and one patch per element (same fields as `update_element`); `update_element_labels` does the same for layer labels. An id that does not exist is skipped in either, not an error:

```json
{"patches": [{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "x": 40, "y": 50}], "updated_at": 1727000010000}
```

`delete_elements` removes a whole selection; `get_elements_by_ids` reads one back in a single call instead of one `get_element` per shape (both take a plain list of ids):

```json
{"ids": ["5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"]}
```

`add_elements`, `update_elements`, `update_element_labels` and `delete_elements` each hold at most 200 items; a bigger call is refused whole, so chunk a large selection client-side. `get_elements_by_ids` has no such cap.

### Move, resize or restyle an element

Call `update_element` with only the fields to change and a newer `updated_at`:

```json
{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "x": 300, "y": 60, "width": null, "height": null, "rotation": null, "fill": "#22c55e", "stroke": null, "stroke_width": null, "opacity": null, "corner_radius": 8, "updated_at": 1727000010000}
```

`update_shadow` sets or clears the drop shadow; `update_element_label` names the layer.

### Reorder layers

`bring_to_front` or `send_to_back` with `{"id": "<element id>"}`, or `set_layer_index` to move one step:

```json
{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "index": 0, "updated_at": 1727000020000}
```

### Make a presentation screen

Add a rectangle covering the slide area, then label it:

```json
{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "label": "screen/01 Sign in", "updated_at": 1727000030000}
```

Everything painted inside the rectangle belongs to the slide. Screens play left to right, then top to bottom.

### Comment

`add_comment` pins a comment at a canvas point; `add_reply` answers it:

```json
{"id": "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d", "x": 120, "y": 90, "content": "Bigger logo?", "created_at": 1727000040000}
```

```json
{"comment_id": "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d", "reply_id": "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", "content": "Agreed", "created_at": 1727000050000}
```

### Share editing rights

As an admin, find the member in `get_members` (or `list_roles`) and call `grant_editor`:

```json
{"member": "<member id from get_members>"}
```

`revoke_editor` takes the same argument. `get_role` with a member id, or `my_role` with `{}`, reads a role.

### Rename the board or hand it over

As the owner, `update_board` renames it (`null` leaves a field unchanged):

```json
{"name": "Landing page v2", "description": null}
```

`transfer_ownership` with `{"new_owner": "<member id>"}` makes another joined member the owner and admin, and removes the caller's admin role.

## Rules and limits

- Only admins and editors may change elements or comments; viewers get `view-only: editor or admin access is required to modify this board`.
- A member must `join` (or move their cursor) before anyone can grant them a role or ownership; until then `grant_editor` fails with `that member hasn't opened this board yet`.
- `update_board` and `transfer_ownership` are owner-only. `clear_elements` and `clear_comments` are admin-only and delete for everyone.
- An element is replaced as a whole by the write with the larger `updated_at`, so always send a timestamp newer than the element's current one.
- Update calls on an unknown element id succeed and change nothing; check `get_element` first.
- `add_element` with an existing id replaces that element.
- A batch call (`add_elements`, `update_elements`, `update_element_labels`, `delete_elements`) holds at most 200 items; over that the whole call is refused and nothing changes. A `delete_elements` batch can still run out of gas on a large board before it hits that count; halve the batch and retry.
- Image and SVG elements need `blobId` of a blob already on the node (`upload_blob`); the contract announces it to the board's members.
- `/` is reserved in layer names: it separates groups.
