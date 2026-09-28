# MeroDesign

## Overview

MeroDesign is a collaborative, Figma-style design canvas.
A board holds elements (shapes, lines, paths, text, images, SVGs), members, comments and live pointers.

- `get_board()` returns the board's `name`, `description`, `elementCount`, `memberCount` and `owner`.
- `get_elements()` returns every element in paint order (lowest `layerIndex` first).
- `get_members()`, `list_roles()`, `get_comments()` and `get_cursors()` return the rest of the board.

Coordinates are canvas pixels: `x` and `y` are an element's top-left corner, and `rotation` is in degrees.
`opacity` is a percentage from 0 to 100.
Timestamps (`timestamp`, `created_at`, `updated_at`) are the caller's clock in unix milliseconds.
Element, comment and reply ids are chosen by the caller; use a fresh UUID for each.
Element keys are camelCase (`strokeWidth`, `layerIndex`, `updatedAt`); method arguments and batch patches are snake_case (`stroke_width`, `updated_at`), as the method schemas show.
An optional argument or field may be omitted or sent as `null`; the two mean the same.

An element's `data` says what it is, tagged by `kind`:

| kind | extra `data` fields |
| ---- | ------------------- |
| `rect` | none |
| `circle` | none; drawn with diameter `width`, so set `height` equal to it |
| `line`, `arrow` | `points`: `"x1,y1 x2,y2"` in element-local pixels |
| `path` | `points`: SVG path data, e.g. `"M 0 0 L 40 40"` |
| `text` | `content`, `fontSize`, `fontFamily`, `bold`, `italic`, `text_align` (`left`, `center`, `right`) and `vertical_align` (`top`, `middle`, `bottom`), each optional |
| `image`, `svg` | `naturalWidth`, `naturalHeight`, `blobId` (a blob on the node) |

Layer names are element labels.
A label is a `/`-separated path: the last segment is the layer's name and the segments before it are its groups (`topbar/logo`).
A `rect` labelled `screen/<name>`, directly under `screen`, is a presentation screen (one slide); a trailing ` @<n>` on its name fixes its place in the play order.

## Context model

One context is one board (the web app calls it a project), running the bundle's single service.
A board lives in a team, which is a namespace of this app; each board gets its own Open group inside the team, and the board's context sits in that group.
A board is created with init arguments `name` and `description`.
The creator becomes the board's owner and its only admin.

A member id is an account id (64 hex): one person on two devices is one member.
`get_members` lists everyone who has called `join`; `list_group_members` for the board's group lists the accounts in it under `identity`.

Roles:

- admin: may edit, grant and revoke the editor role, and clear the board. The owner is an admin.
- editor: may add, change and delete elements and comments.
- viewer: everyone else, read-only. Every member may still `join`, rename themselves and move their pointer.

## Getting started

Every app tool (and `call`) takes an `app_handle`. Get one from `select_app` with `app` and `context`; the handle binds the board the call runs against. The JSON examples in this guide show only the method's own arguments.

To open an existing board, `list_contexts` with `application` `com.calimero.mero-design`; each context is a board, named by its `name`, and its `groupId` is the board's group. Then do steps 5 and 6.

To create a board:

1. `list_applications` and find the package `com.calimero.mero-design`.
2. `list_namespaces` and reuse the team's namespace, or `create_namespace` with `application` set to the package and `name` set to the team name.
3. `create_group` with `namespace` set to the team's namespace id, `name` set to the board name and `visibility` `open`. Keep the returned group id.
4. `create_context` with `application`, `group` set to that group id, `name` (the board name) and `args`:

   ```json
   {"application": "com.calimero.mero-design", "group": "<group id>", "name": "Landing page", "args": {"name": "Landing page", "description": ""}}
   ```

   If a response to `create_namespace` or `create_context` is lost, look for the name in `list_namespaces` or `list_contexts` before retrying, or you create a duplicate.
   No tool lists a namespace's groups, so a group whose `create_group` response was lost stays behind with no board in it; create a new one.
5. `select_app` with `app` `com.calimero.mero-design` and `context` set to the board's context id; keep the returned `app_handle`.
6. Call `join` so the board lists you as a member:

   ```json
   {"username": "bot", "avatar": null, "timestamp": 1727000000000}
   ```

## Procedures

### Invite someone to a board

1. `invite_to_namespace` with the team's namespace id, and hand the invitation, the board's group id and its context id to the invitee.
2. On their node they run `join_namespace` with the namespace id and the invitation object exactly as received, `join_open_group` with the group id, `join_context` with the context id, then `select_app` and `join`.
   Joining the context fetches the app onto their node; if `select_app` does not find it yet, wait until `list_applications` shows `com.calimero.mero-design`.
3. They start as a viewer; an admin grants editing with "Share editing rights".

### Add a shape

As an editor, call `add_element`; it returns the id:

```json
{"element": {"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "data": {"kind": "rect"}, "x": 40, "y": 60, "width": 120, "height": 80, "rotation": 0, "fill": "#ef4444", "stroke": "transparent", "strokeWidth": 0, "opacity": 100, "layerIndex": 0, "createdBy": "", "createdAt": 1727000000000, "updatedAt": 1727000000000}}
```

Give each new element a `layerIndex` one above the highest in `get_elements` so it paints on top.
A line is `{"kind": "line", "points": "0,0 120,80"}` with the same box fields.

### Add text

```json
{"element": {"id": "0d6f3a52-1b7e-4c9a-8e2d-5a4b3c2d1e0f", "data": {"kind": "text", "content": "Hello", "fontSize": 24, "fontFamily": "sans-serif", "bold": false, "italic": false}, "x": 40, "y": 200, "width": 200, "height": 36, "rotation": 0, "fill": "#111111", "stroke": "transparent", "strokeWidth": 0, "opacity": 100, "layerIndex": 1, "createdBy": "", "createdAt": 1727000000000, "updatedAt": 1727000000000}}
```

Change it later with `update_text_style`; an omitted or `null` argument leaves that field unchanged:

```json
{"id": "0d6f3a52-1b7e-4c9a-8e2d-5a4b3c2d1e0f", "content": "Hello there", "font_family": null, "font_size": 32, "bold": true, "italic": null, "text_align": "center", "vertical_align": null, "updated_at": 1727000005000}
```

### Add an image

1. `upload_blob` with `data` (the file, base64) and `context` set to the board's context id; keep the returned blob id.
2. `add_element` with `data` `{"kind": "image", "naturalWidth": 640, "naturalHeight": 480, "blobId": "<blob id>"}` (or `"kind": "svg"` for an SVG) and the box fields as for a shape.

### Move, resize or restyle an element

Call `update_element` with the fields to change and the current time as `updated_at`; an omitted or `null` argument leaves that field unchanged:

```json
{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "x": 300, "y": 60, "width": null, "height": null, "rotation": null, "fill": "#22c55e", "stroke": null, "stroke_width": null, "opacity": null, "corner_radius": 8, "updated_at": 1727000010000}
```

`update_shadow` sets or clears the drop shadow; `update_element_label` names the layer.

### Work on many elements at once

`add_elements`, `update_elements`, `update_element_labels` and `delete_elements` each take up to 200 items and emit one event per call when anything changed:

```json
{"patches": [{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "x": 40, "y": 50}], "updated_at": 1727000010000}
```

`update_elements` patches use the `update_element` argument names and leave omitted or `null` fields unchanged; `update_element_labels` takes `{"labels": [{"id": "<element id>", "label": "topbar/logo"}], "updated_at": ...}`.
`delete_elements` and `get_elements_by_ids` take `{"ids": ["<element id>"]}`; `get_elements_by_ids` has no size limit.

### Reorder layers

`bring_to_front` or `send_to_back` with `{"id": "<element id>"}`, or `set_layer_index` to move it to a given position (0 is the back):

```json
{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "index": 0, "updated_at": 1727000020000}
```

### Make a presentation screen

Add a `rect` covering the slide area, then label it:

```json
{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "label": "screen/01 Sign in", "updated_at": 1727000030000}
```

Everything painted inside the rectangle belongs to the slide.
Screens numbered with ` @<n>` play first, in number order; the rest follow in reading order: rows top to bottom, left to right within a row.

### Comment

`add_comment` pins a comment at a canvas point; `add_reply` answers it:

```json
{"id": "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d", "x": 120, "y": 90, "content": "Bigger logo?", "created_at": 1727000040000}
```

```json
{"comment_id": "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d", "reply_id": "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", "content": "Agreed", "created_at": 1727000050000}
```

`delete_reply` takes `comment_id` and `reply_id`; `delete_comment` takes `{"id": "<comment id>"}` and removes its replies too.

### Share editing rights

As an admin, take the member id from `get_members` (or an `identity` from `list_group_members` for the board's group) and call `grant_editor`:

```json
{"member": "<member id>"}
```

The account need not have joined the board yet.
`revoke_editor` takes the same argument. `get_role` with a member id, or `my_role` with `{}`, reads a role.

### Rename the board or hand it over

As the owner, `update_board` renames it (an omitted or `null` argument is left unchanged):

```json
{"name": "Landing page v2", "description": null}
```

`transfer_ownership` with `{"new_owner": "<member id>"}` makes that account the owner and an admin; the caller stops being an admin and cannot undo it.
If the response is lost, check `owner` in `get_board` before retrying: a repeat fails once the transfer has landed.

### Clear the board

As an admin, `clear_elements` with `{}` deletes every element, and `clear_comments` with `{}` deletes every comment and reply, for every member.

## Rules and limits

- Only admins and editors may change elements or comments; viewers get `view-only: editor or admin access is required to modify this board`.
- `update_board` and `transfer_ownership` are owner-only; `clear_elements`, `clear_comments`, `grant_editor` and `revoke_editor` are admin-only.
- Concurrent changes to one element are not merged field by field: one member's whole version of the element replaces the other's. Send the current time as `updated_at`.
- Updates, reorders and deletes on an unknown id succeed and change nothing; check `get_element` first.
- `add_element` with an existing id replaces that element. If a response is lost, check `get_element` or `get_comments` first and re-send with the same ids only if the item is missing; a blind re-send can overwrite another member's newer edit.
- A batch holds at most 200 items; over that the whole call is refused and nothing changes. On a large board `delete_elements` can run out of gas well below 200 ids; halve the batch and retry.
- Deletes and clears cannot be undone.
- `/` is reserved in layer names: it separates groups.
- `delete_context` removes a board from this node only; the other members keep it.
