# MeroDesign

## Overview

MeroDesign is a collaborative, Figma-style design canvas.
A board holds elements (shapes, lines, paths, text, images, SVGs), members, comments and live pointers.

- `getBoard()` returns the board's `name`, `description`, `elementCount`, `memberCount` and `owner`.
- `getElements({"cursor": null})` returns a page of elements in paint order (lowest `layerIndex` first) as `{"items": [..], "next": ..}`; pass `next` as `cursor` until it is `null`.
- `getComments({"cursor": null})` pages comments the same way, each with its replies.
- `getMembers()`, `listRoles()` and `getCursors()` return the rest of the board.

Coordinates are canvas pixels: `x` and `y` are an element's top-left corner, and `rotation` is in degrees.
Colours are CSS colours (`"#ef4444"`, `"transparent"`, `"rgba(0,0,0,0.3)"`).
`opacity` is a percentage from 0 to 100.
Timestamps (`timestamp`, `createdAt`, `updatedAt`) are the caller's clock in unix milliseconds.
Element, comment and reply ids are chosen by the caller; use a fresh UUID for each.
Method names and method arguments are camelCase (`updateElement`, `updatedAt`, `commentId`).
A 64-bit integer ARGUMENT (`timestamp`, `createdAt`, `updatedAt`, and `x`/`y` of `updateElement`, `addComment` and `updateCursor`) is a decimal string: `"updatedAt": "1727000010000"`.
An element's own 64-bit fields (`x`, `y`, `createdAt`, `updatedAt`) are decimal strings too, both in `addElement` and in what `getElement(s)` answers (`"x": "40"`); its other numbers are JSON numbers.
Elsewhere (a patch, a comment, a member, a pointer) numbers are JSON numbers.
An element's keys are camelCase (`strokeWidth`, `layerIndex`, `updatedAt`); the fields of an `updateElements` patch are snake_case (`stroke_width`, `corner_radius`).
Errors are `Forbidden` or `Invalid`, each with a `message`.

An element's `data` says what it is, tagged by `kind`:

| kind | extra `data` fields |
| ---- | ------------------- |
| `rect`, `circle` | none |
| `line`, `arrow` | `points`: `"x1,y1 x2,y2"` in pixels from the element's `x`, `y`; an arrow's head is at the second point |
| `path` | `points`: SVG path data, e.g. `"M 0 0 L 40 40"` |
| `text` | `content`, `fontSize`, `fontFamily`, `bold`, `italic`, optional `text_align` (`left`, `center`, `right`) and `vertical_align` (`top`, `middle`, `bottom`) |
| `image`, `svg` | `naturalWidth`, `naturalHeight`, `blobId` (the 64-hex id of a blob uploaded to this board; omit it while there is none) |

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

## The app model

One app instance is one board (the web app calls it a project), running this package's single service.
Boards belong to a team, which is an organization: every member of the organization (owner, admins, members, guests) reaches every board in it.
`init` takes no arguments: the board's name is the instance's, and its creator also sets it on the board with `updateBoard`.
The instance's owner becomes the board's owner and its only admin.

Members, roles and ownership belong to accounts: a member id is an account id, the one the organization lists.
One person is one member with one pointer, whatever the device.

Roles:

- admin: everything an editor can do, plus granting and revoking the editor role and clearing the board; the owner is an admin.
- editor: may add, change and delete elements and comments. Every owner and admin of the organization is an editor without a grant.
- viewer: everyone else, read-only, though anyone who reaches the board may still `join`, rename themselves and move their pointer.

## Getting started

1. Find the board: list the app instances of the package `com.calimero.mero-design` in the team's organization, or create one there with a name.
2. On a new board, as its creator, `updateBoard` with the name:

   ```json
   {"name": "Landing page", "description": ""}
   ```

3. Call `join` so other members see a name for you:

   ```json
   {"username": "bot", "avatar": null, "timestamp": "1727000000000"}
   ```

`getBoard` gives the board's current name (`""` until its owner set one: then the instance's name is the name).

## Procedures

### Invite someone to a board

Invite them to the team's organization (an org invite, approved by the inviter's passkey).
Once they redeem it they reach every board in the team; they call `join` on the board.
A new member is a viewer until an admin grants the editor role (see "Share editing rights"), unless they are an admin of the organization.

### Add a shape

As an editor, call `addElement`:

```json
{"element": {"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "data": {"kind": "rect"}, "x": "40", "y": "60", "width": 120, "height": 80, "rotation": 0, "fill": "#ef4444", "stroke": "transparent", "strokeWidth": 0, "opacity": 100, "layerIndex": 0, "createdBy": "", "createdAt": "1727000000000", "updatedAt": "1727000000000"}}
```

Give each new element a `layerIndex` one above the highest in `getElements` so it paints on top.
`createdBy` is required but ignored; the contract records the caller.
For a triangle, diamond, star or cloud, add a `path` whose `points` outline the shape inside its box and label it `"\u001fh=<shape>"`.

### Add text or a sticky note

```json
{"element": {"id": "0d6f3a52-1b7e-4c9a-8e2d-5a4b3c2d1e0f", "data": {"kind": "text", "content": "Hello", "fontSize": 24, "fontFamily": "sans-serif", "bold": false, "italic": false}, "x": "40", "y": "200", "width": 200, "height": 36, "rotation": 0, "fill": "#111111", "stroke": "transparent", "strokeWidth": 0, "opacity": 100, "layerIndex": 1, "createdBy": "", "createdAt": "1727000000000", "updatedAt": "1727000000000"}}
```

A sticky note is a 200 x 200 `text` element with `text_align` `left`, `vertical_align` `top`, a `fill` such as `#FFE27A` and `label` `"\u001fb=sticky"`.

Change text later with `updateTextStyle`; `null` leaves a field unchanged:

```json
{"id": "0d6f3a52-1b7e-4c9a-8e2d-5a4b3c2d1e0f", "content": "Hello there", "fontFamily": null, "fontSize": 32, "bold": true, "italic": null, "textAlign": "center", "verticalAlign": null, "updatedAt": "1727000005000"}
```

### Add an image

Upload the image bytes as a blob of this board's app instance (`POST /apps/{app}/blobs`), then `addElement` with `data` `{"kind": "image", "naturalWidth": 800, "naturalHeight": 600, "blobId": "<the blob's hex id>"}` (`svg` works the same).
The element holds the blob (a `BlobRef`): the node keeps it while an element refers to it, and members read it from the same instance.
A `blobId` this board does not hold is refused, and the whole call with it: upload the bytes to this board first (the same bytes give the same id).

### Move, resize or restyle an element

Call `updateElement` with the fields to change (`null` for the rest) and the time:

```json
{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "x": "300", "y": "60", "width": null, "height": null, "rotation": null, "fill": "#22c55e", "stroke": null, "strokeWidth": null, "opacity": null, "cornerRadius": 8, "updatedAt": "1727000010000"}
```

`updateShadow` sets all four shadow fields at once (all `null` removes the shadow), and `updateElementLabel` renames the layer.

### Work on many elements at once

`addElements`, `updateElements`, `updateElementLabels` and `deleteElements` each do a whole selection in one call:

```json
{"patches": [{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "x": 40, "y": 50}], "updatedAt": "1727000010000"}
```

```json
{"ids": ["5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"]}
```

`addElements` returns the ids in order; the update batches skip unknown ids.
`getElementsByIds` reads a list of ids back in one call.

### Reorder layers

`bringToFront` or `sendToBack` with `{"id": "<element id>"}`, or `setLayerIndex` to put one element at an exact position (0 is the back):

```json
{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "index": 0, "updatedAt": "1727000020000"}
```

### Group layers or make a presentation screen

Group by giving elements labels with the same prefix (`updateElementLabels` with `topbar/logo`, `topbar/menu`).
For a screen, add a `rect` covering the slide area, then label it:

```json
{"id": "5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90", "label": "screen/01 Sign in", "updatedAt": "1727000030000"}
```

### Comment

`addComment` pins a comment at a canvas point; `addReply` answers it:

```json
{"id": "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d", "x": "120", "y": "90", "content": "Bigger logo?", "createdAt": "1727000040000"}
```

```json
{"commentId": "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d", "replyId": "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", "content": "Agreed", "createdAt": "1727000050000"}
```

`deleteReply` and `deleteComment` remove them.
Editing a comment's text is not supported: delete it and add a new one.

### Share editing rights

As an admin, take the member id from `getMembers`, `listRoles` or the organization's member list, and call `grantEditor`:

```json
{"member": "<member id>"}
```

The person must be an account of the team's organization; they do not need to have opened the board yet.
`revokeEditor` takes the same argument.
`getRole` with a member id, or `myRole` with `{}`, reads a role.

### Rename the board or hand it over

As the owner, `updateBoard` renames it (`null` leaves a field unchanged):

```json
{"name": "Landing page v2", "description": null}
```

`transferOwnership` with `{"newOwner": "<member id>"}` makes that account owner and admin, and removes the caller's admin role, so the caller can no longer edit unless granted editor.
This only changes the board's own roles; the app instance and the team are unchanged.

## Rules and limits

- Only admins and editors may change elements or comments; viewers get `view-only: editor or admin access is required to modify this board`.
- `updateBoard` and `transferOwnership` are owner-only.
- `grantEditor`, `revokeEditor`, `clearElements` and `clearComments` are admin-only.
- `clearElements`, `clearComments`, `deleteElement`, `deleteElements`, `deleteComment` and `deleteReply` delete for every member and cannot be undone.
- `clearElements` and `clearComments` delete at most 1,000 rows per call and answer how many are left (`"0"` when done); call again until then.
- Deleting the board's app instance (its creator, or an admin of the organization) deletes the whole board for the team, as the web app's Delete board does, and cannot be undone.
- Every write is applied in order; the later write to an element wins.
- `addElement` or `addComment` with an existing id replaces that element or comment, so a retried add is safe.
- An unknown element id is not an error, and `addReply` to an unknown comment silently does nothing.
- Check `getElement` before updating or reordering an element you did not just add.
- A batch call holds at most 200 items; over that the whole call is refused and nothing changes.
- `getElements` answers a page: `limit` defaults to 500 and is capped at 1,000; `getComments` defaults to and is capped at 100 comments per page.
- A comment's thread holds at most 200 replies; `addReply` past that is `Invalid`.
- `getMembers`, `listRoles`, `getCursors` and `getElementsByIds` answer at most 1,000 each.
- `/` is reserved inside a layer name: it separates groups.
- An empty board name in `updateBoard` shows the instance's name.
