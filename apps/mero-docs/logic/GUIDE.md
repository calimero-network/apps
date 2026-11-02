# Mero Docs

## Overview

Mero Docs is a shared document workspace.
A workspace holds folders, and each folder holds rich-text documents.
A document is a title plus an ordered list of blocks (paragraph, heading, bullet item, image), each with its own formatted text.

The package has one component, and the web app creates two kinds of app instance from it:

- the workspace's **registry**: the registry owner, its managers, the workspace tags and the saved views.
  Every member of the organization reaches it, so it holds nothing about folders.
- a folder's **documents**: the documents, comments and document tags of one folder.

Both kinds answer every method, but call the registry methods on the registry and the document methods on a folder's instance.
Method names and argument names are camelCase, and arguments are a JSON object with exactly the method's parameters.

## Context model

- A workspace is an organization.
  Its name is the organization's name; members' display names are organization member metadata `{"name": "..."}`.
- The workspace has exactly one registry: an app instance of package `com.calimero.mero-drive-docs` in the organization with the default (organization) access.
  Its app id is kept in the organization's metadata as `registryApp`.
  Never create a second one: the web app would have to guess which is real.
- A folder is a team of the organization; a subfolder is a team whose `parent` is the folder's team.
  An open folder is a team with `join: everyone`, a restricted folder one with `join: invite`.
- Every folder has exactly one documents instance, created with access `{"kind": "team", "team": "<team id>"}`.
  Its app id is kept in the team's metadata as `docsApp`, beside `color` (`#rrggbb`).
  One instance per folder, never one per document.
- Folder roles are team rows: Manager is `lead`, Editor is `member`, Viewer is `readOnly`.
  The node refuses every write by a `readOnly` row with `403`.
- People are named by account id.

## Getting started

1. Sign in, then create an organization with the workspace's name.
2. Create the registry: an app of package `com.calimero.mero-drive-docs` in the organization, with no `initArgs`.
   You are its owner.
   Set the organization's metadata to `{"registryApp": "<app id>"}`, repeating any keys it already holds.
3. Create the first folder as described under "Create a folder", then write a document as described under "Write a document".

## Procedures

### Find an existing workspace and its folders

1. Read your account (`/me`) and pick the organization by name.
2. Read the organization: its `metadata.registryApp` is the registry, and each team in `teams` is a folder you reach, its `metadata.docsApp` the folder's documents instance.
3. Call the document methods on that `docsApp`.

### Create a folder

1. Create a team with the folder's name, `join` set to `everyone` (open) or `invite` (restricted) and, for a subfolder, `parent` set to the parent folder's team.
2. Create an app of the package in the organization with access `{"kind": "team", "team": "<team id>"}` and the folder's name.
3. Update the team's metadata to `{"docsApp": "<app id>", "color": "#3b82f6"}`.

Nothing is written to the registry.
The web app refuses folders nested deeper than 8 levels and names longer than 128 characters; stay within both.

### Write a document

1. `createDoc` with `title`; keep the returned document id.
2. `insertBlock` with `doc`, `after` set to `null` (the top), `kind` set to `paragraph` and `depth` set to `0`; keep the block id.
3. `applyDelta` with `doc`, `block` and `ops`:

   ```json
   {"doc": "<doc id>", "block": "<block id>", "ops": [{"insert": "Hello world", "attributes": {}}]}
   ```

4. To add another block below, `insertBlock` with `after` set to the previous block's id.

The web editor uses the block kinds `paragraph`, `heading` (attribute `level`, `"1"` to `"3"`), `bulletListItem` and `image`.
`depth` nests a block under the block above it.
Reshape blocks with `moveBlock` (`doc`, `block`, `after`), `setKind`, `setDepth`, `setAttr`, `splitBlock` (`doc`, `block`, `at`) and `mergeBlocks` (`doc`, `first`, `second`).

### Add an image

1. Upload the image as a blob of the folder's documents instance; keep its id.
2. `insertBlock` with `kind` `image`, then `setAttr` with `key` `url` and `value` `blob:<blob id>`, and `setAttr` with `key` `name` and the file name.

The web app shows PNG, JPEG, GIF and WebP images of at most 10 MB.
Leave an image block's text empty.

### Read documents

- `listDocs` with `includeArchived` lists headers: title, tag keys, archived flag, creator, last editor and timestamps.
  Timestamps are milliseconds since the Unix epoch, as decimal strings.
- `getDocument` returns every block in order with its kind, depth, attributes, formatted `spans` and character `ids`.
- `getBlock` returns one block, or `null`; `getText` one block's plain text; `getTitle` the title; `getDoc` with `id` one header.
- `searchDocs` with `query`, `includeArchived`, `cursor` and `limit` finds documents whose title and body hold a word starting with each query word, best match first.
  Pass `null` as `cursor` and `limit` for the first page of 20, then the returned `nextCursor`.
  The query is at most 256 bytes.

### Edit text

An edit is a list of steps that walk the block's text as it was before the edit:
`{"retain": n}` skips n characters, `{"insert": "text", "attributes": {}}` adds text, `{"delete": n}` removes n characters.
Text after the last step is kept.
Positions count Unicode scalar values.

Edit safely like this, because another member may change the text between your read and your write:

1. `getBlock` and join the `text` of its `spans`: that is the base.
2. Compute the steps against the base, then `applyDeltaOn` with `doc`, `block`, `base`, `ops` and `anchor` set to `null`.
3. When it answers `applied: false` nothing was written; its `spans` are the current text, so recompute and repeat step 2.

- For the title, read `getTitleState` and use `titleApplyDeltaOn` with its `text` as `base`.
  The title takes no formatting.
- Rename a document outright with `editDoc`.
- `undo` and `titleUndo` take the token an edit returned, and return the token that redoes it.

### Format text

- An insert's `attributes` are its whole formatting: `{"insert": "x", "attributes": {"bold": "true"}}`.
- A `retain` step with `attributes` changes only the keys it names; a `null` value removes one.
- Or use `mark` with `start` inclusive, `end` exclusive, `key` and `value`; `value: null` clears the key.
- Keys are `bold`, `italic`, `underline`, `strike`, `code`, `link` (value is the URL), `comment`, `textColor` and `backgroundColor`.
  Any other key is refused.

### Tag documents

1. On the registry, `setTag` with `key` (lowercase letters, digits and `-`, at most 64 characters), `name` (1 to 32 characters) and `color` (`#rrggbb`).
   `listTags` shows the workspace's tags; a deleted key is listed with `deleted: true` and cannot be reused.
2. On the folder's instance, `addTag` with `id` and `tag` set to the key; `removeTag` takes it off.

### Comment on a document

- `addComment` with `docId` and `body`; `listComments` with `docId` returns them with the author's account.
- Only the author can `editComment`.
  The author or the folder's moderator (whoever created the folder's instance) can `deleteComment`.

### Archive and delete a document

- `archiveDoc` hides a document from `listDocs`; `unarchiveDoc` brings it back.
- `deleteDoc` removes the document, its body, tags and comments for good.
  Only its creator or the folder's moderator may; `canDelete` on the header says so.

### Rename, recolour or remove a folder

- Update the team: `name`, and `metadata` with `docsApp` and `color` together, since metadata is replaced whole.
- Deleting the team deletes its subfolders and their documents instances with it.

### Invite someone and share folders

1. Make an organization invite with a role and, for restricted folders, the folders' teams; hand over the token.
2. The invitee redeems it after signing in.
   Open folders are reached at once; a restricted folder needs a team row (the invite's teams, or a manager adding them).
3. Make someone a Viewer of a folder by setting their team row's role to `readOnly`, and back with `member`.

## Rules and limits

- Ids (documents, blocks, comments, undo tokens, anchors) are opaque strings: take them from a result and pass them back unchanged.
- The registry owner is whoever created the registry.
  Only the owner adds and removes managers, with `addManager` and `removeManager`; `getOwner` and `listManagers` read them.
- A title is at most 1024 characters, a block's text at most 100000 and a comment at most 10000; a write past one is refused and nothing is stored.
- `createDoc`, `insertBlock`, `splitBlock` and `addComment` create a second item on a repeat, so after a lost response check `listDocs`, `listBlocks` or `listComments` first.
- `deleteDoc`, `deleteBlock`, `deleteComment`, `deleteTag` and `deleteView` cannot be undone: confirm first.
