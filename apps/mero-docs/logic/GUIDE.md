# Mero Docs

## Overview

Mero Docs is a shared document workspace.
A workspace holds folders, and each folder holds rich-text documents.
A document is a title plus an ordered list of blocks (paragraph, heading, bullet item, image), each with its own formatted text.

The bundle has two services, and every context runs exactly one of them:

- `registry` holds workspace-level data only: the registry owner, its managers, the tags and the saved searches.
  Every workspace member replicates it, so it holds nothing about folders.
  Folders are core groups: the tree, names, colours, docs contexts and roles all live in core.
- `docs` holds the documents, comments and document tags of one folder.

`describe_app` and `select_app` show one service's methods at a time: pass `service` (`registry` or `docs`) to `describe_app`, or a `context` to `select_app`.
Per-method tools may be available; the `call` tool always works, passing the `app_handle` from `select_app`, the `method` name and its `args` keyed by parameter name.

## Context model

- A workspace is a namespace.
  `create_namespace` makes it, and the namespace id is also the id of its root group.
- The workspace has exactly one `registry` context, created inside the root group (pass the namespace id as `group`) with the name `Registry`.
  Never create a second one: the web app would have to guess which is real.
- A folder is a group inside the namespace, and its group id is the folder id.
  A subfolder is a group created with `parent` set to the folder's group id.
- Every folder has exactly one `docs` context, created inside the folder's own group (pass the folder's group id as `group`) with the folder's name.
  This is the rule agents most often get wrong: one docs context per folder, never one per document or in the root group.
- Documents live inside their folder's docs context.
  Two documents in one folder share a context; documents in different folders never do.
- A folder's name and colour are its group's metadata: `name`, and `color` (`#rrggbb`) in its `data`.
- A folder's roles and capabilities are core's, in the folder's group, not registry data.
- A folder is `open` (every workspace member can join it) or `restricted` (members must be added to the folder's group).
- People are named by account id, 64 hex characters, as `list_group_members` shows them.

## Getting started

Every method call takes the `app_handle` that `select_app` returned for the context you want to act in.
The JSON examples below show only the method's own arguments.

1. `list_applications` and find the package `com.calimero.mero-drive-docs`.
2. `create_namespace` with `application` and `name` set to the workspace name.
   Keep the returned `namespaceId`.
3. `create_context` with `application`, `group` set to the namespace id, `service` set to `registry` and `name` set to `Registry`.
   It takes no `args`.
   Keep the returned `contextId`: you are now the registry owner.
4. Pin the registry so every node agrees on it: `set_group_metadata` with `group` set to the namespace id, `name` set to the workspace name and `data` set to `{"mero-drive.registryContext": "<registry context id>"}`.
   Never call `set_group_metadata` on the namespace again without repeating this key, because `data` replaces the whole record.
5. Create the first folder as described under "Create a folder", then write a document as described under "Write a document".

## Procedures

### Find an existing workspace and its folders

1. `list_namespaces` and pick the workspace by `name`.
2. `list_contexts` with `application` set to the package.
   The registry is the context whose `serviceName` is `registry` and whose `groupId` is the namespace id.
   Every context whose `serviceName` is `docs` is a folder's docs context, and its `groupId` is the folder id.
3. `select_app` with `context` set to a docs context id to work in that folder's documents.

The web app finds the folder tree by walking core's subgroup listing down from the root group.
`list_contexts` shows only the contexts this node holds, so a folder you have not joined is not in it.
A folder whose group has not reached this node yet answers `group '<id>' not found`: it is not synced, not removed.
Wait and retry; never treat it as deleted and never recreate it.

### Create a folder

Do the steps in this order, and stop at the first failure.

1. `create_group` with `namespace`, `visibility` (`open` or `restricted`) and, for a subfolder, `parent` set to the parent folder's group id.
   Always pass `visibility`, because the default differs: `open` without a `parent`, `restricted` under one.
   Leave `name` out.
   Keep the returned `groupId`: it is the folder id.
2. `set_group_metadata` with `group` set to the folder id and `name` set to the folder name.
   Naming after the visibility keeps an open folder's name readable to every workspace member.
   For a colour, also pass `data` set to `{"color": "#3b82f6"}`.
3. `create_context` with `application`, `group` set to the folder id, `service` set to `docs` and `name` set to the folder name.
   It takes no `args`.
   Keep the returned `contextId`: being the one context in the folder's group is what makes it the folder's docs context.

Nothing is written to the registry.
The web app refuses folders nested deeper than 8 levels and names longer than 128 characters; stay within both.
If a step fails for another reason, the group and context from the earlier steps remain; reuse them on the retry instead of creating new ones, because this tool set cannot delete a group.

### Write a document

1. `select_app` with `context` set to the folder's docs context id.
2. `call` `create_doc` with `title`.
   Keep the returned document id.
3. `call` `insert_block` with `doc`, `after` set to `null` (insert at the top), `kind` set to `paragraph` and `depth` set to `0`.
   Keep the returned block id.
4. `call` `apply_delta` with `doc`, `block` and `ops` set to the text to insert:

   ```json
   {"doc": "<doc id>", "block": "<block id>", "ops": [{"insert": "Hello world", "attributes": null}]}
   ```

5. To add another block below, `insert_block` with `after` set to the previous block's id.

The web editor uses the block kinds `paragraph`, `heading` (attribute `level`, `"1"` to `"3"`), `bulletListItem` and `image`.
`depth` nests a block under the block above it.
Set a heading with `set_kind` to `heading` and `set_attr` with `key` `level`.
Reshape blocks with `move_block` (`doc`, `block`, `after`; `null` moves it to the top), `set_depth` (`doc`, `block`, `depth`) and `merge_blocks` (`doc`, `first`, `second`; appends the second block's text to the first and removes the second).

### Add an image

1. `upload_blob` with `context` set to the folder's docs context id and `data` set to the image bytes in base64.
   Keep the returned `blobId`.
2. `insert_block` with `kind` set to `image`, then `set_attr` with `key` `url` and `value` `blob:<blobId>`, and `set_attr` with `key` `name` and the file name.

The web app adds PNG, JPEG, GIF and WebP images of at most 10 MB, and shows only those types from a `url` of `blob:` plus 64 hex characters; anything else shows as unavailable.
Leave an image block's text empty.

### Read documents

- `list_docs` with `include_archived` lists metadata only: title, tag keys, archived flag, creator and timestamps.
  Timestamps are nanoseconds since the Unix epoch.
- `get_document` returns every block in order with its kind, depth, attributes and formatted `spans`.
- `get_block` returns one block the same way, or `null`; `get_text` returns one block's plain text; `get_title` returns the title; `get_doc` with `id` returns one document's metadata row.
- `search_docs` with `query`, `include_archived`, `cursor` and `limit` finds documents by title and body words, best match first.
  Pass `null` as `cursor` and `limit` for the first page of 20, then the returned `next_cursor`.
  The query is at most 256 bytes.
  A node running with search off answers with an error; read `list_docs` and `get_document` instead.
- In the registry, `save_view` with `id`, `name` and `query` saves a workspace-wide search, and `list_views` lists them.

### Edit text

An edit is a list of steps that walk the block's text as it was before the edit:
`{"retain": n, "attributes": null}` skips n characters, `{"insert": "text", "attributes": null}` adds text, `{"delete": n}` removes n characters.
Text after the last step is kept, so replacing the first 5 characters is `[{"delete": 5}, {"insert": "Howdy", "attributes": null}]`.
Send `"attributes": null` on every retain and insert step; the call is refused without it.
Positions count Unicode scalar values.

Edit safely like this, because another member may change the text between your read and your write:

1. `get_block` and join the `text` of its `spans`: that is the base.
2. Compute the steps against the base, then `apply_delta_on` with `doc`, `block`, `base`, `ops` and `anchor` set to `null`.
3. When it answers `applied: false` nothing was written; its `spans` (`text` for the title) are the current text, so recompute from them and repeat step 2.

- For the title, read `get_title_state` and use `title_apply_delta_on` with its `text` as `base`, the same way.
  The title takes no formatting.
- Rename a document outright with `edit_doc`.
- `undo` and `title_undo` take the token that the edit returned.

### Format text

- `apply_delta` with a `retain` step that carries `attributes` formats the retained range, for example `{"retain": 5, "attributes": {"bold": "true"}}`.
- Or use `mark` with `start` inclusive, `end` exclusive, `key` and `value`; `value: null` clears the key.
- Keys are `bold`, `italic`, `underline`, `strike`, `code`, `link` (value is the URL), `comment`, `textColor` and `backgroundColor`.
  Any other key is refused.
- A range past the end of the block's text is refused.
- Insert the text first and format the range afterwards with `mark`.
  Text inserted directly after a `bold`, `italic`, `underline`, `strike`, `textColor` or `backgroundColor` range takes that formatting; `link`, `code` and `comment` do not spread.

### Tag documents

1. In the registry, `set_tag` with `key` (lowercase letters, digits and `-`, at most 64 characters), `name` (1 to 32 characters) and `color` (`#rrggbb`).
   `list_tags` shows the workspace's tags; a deleted key is listed with `deleted: true` and cannot be reused.
2. In the folder's docs context, `add_tag` with `id` and `tag` set to the key.
   `remove_tag` takes it off.

A tag is workspace-wide, but the tag list lives in the registry and each document carries only keys.

### Comment on a document

- `add_comment` with `doc_id` and `body`; `list_comments` with `doc_id` returns them with the author's account id and a `created_at`.
- Only the author can `edit_comment`.
  The author or the folder's moderators can `delete_comment`.
- A member who is Read only on the folder cannot comment.

### Archive and delete a document

- `archive_doc` hides a document from `list_docs`; `unarchive_doc` brings it back.
  Nothing is lost.
- `delete_doc` removes the document, its body and its comments for good.
  Only its creator or a moderator (who created the folder's docs context) may; `can_delete` on the `list_docs` row says so.

### Rename or recolour a folder

- `set_group_metadata` with the folder id, the `name` and `data` set to `{"color": "#rrggbb"}`, or without `color` to clear it.
  `data` replaces the whole record, so pass the name and the colour together.
- It takes the permission to change the folder group's metadata; nothing is written to the registry.

### Remove a folder

The web app removes a folder with one core group delete, which removes its subfolders and their docs contexts with it.
This tool set cannot delete a group, so the closest it comes is:

1. Remove subfolders first, deepest first.
2. `delete_context` with the folder's docs context id (from `list_contexts`).
   This removes the context and its documents from this node; the empty group stays in the namespace.

There is no tool to move a folder under another parent.

### Invite someone and share folders

1. On your node, `invite_to_namespace` with the namespace id.
   Hand the whole returned object to the invitee.
2. On the invitee's node: `join_namespace` with `namespace`, the object's `invitation` field as `invitation` passed through unchanged, and its `groupName` as `groupName`.
   Passing the whole object as `invitation` is refused.
   The answer's `memberAccount` is the invitee's account id, which the inviter needs to assign roles.
   Then `join_context` with the registry context id.
3. For every folder the invitee should open, top-down so a subfolder follows its parent: for an `open` folder, `join_open_group` with the folder's group id, then `join_context` with the folder's docs context id (from `list_contexts` on a node that holds it, such as the inviter's).
4. A `restricted` folder cannot be self-joined: an admin of the folder's group calls `add_group_members` with `group` set to the folder id and `members` set to `[{"identity": "<account id>", "role": "Member"}]`, and only then does the invitee call `join_context`, which otherwise hangs until it times out.

### Make a member Read only on a folder

A Read only member can open the folder's documents but not change them or comment; the node refuses each write.
The node enforces the member's `ReadOnly` role in the folder's group, and nothing about roles is stored in the registry.

1. An admin of the folder's group calls `add_group_members` with `group` set to the folder id and `members` set to `[{"identity": "<account id>", "role": "ReadOnly"}]`.
   This adds the row or changes an existing one.
2. Repeat it for every `open` sub-folder reached from this folder through `open` folders only.
   A `restricted` sub-folder keeps the member's own role there.
   This tool set cannot read a group's visibility, so go by the visibility each folder was created with.

To end it, do the same steps with `Member`.

### Change a folder's visibility

1. `set_group_visibility` with `group` set to the folder id and `visibility` set to `open` or `restricted`.
   It needs admin or the manage-visibility capability on the folder's group.
2. Only the folder's creator can switch a restricted folder to `open`; anyone else is refused.
   Restricting works for any admin or holder of that capability.
3. After opening, repeat "Make a member Read only on a folder" for each member who is `ReadOnly` in the parent folder: here and in every `open` sub-folder reached through `open` folders only, parents first.
   Otherwise Read only no longer covers them.
4. Restricting removes everyone who only had inherited access, in the folder and its sub-folders, so confirm first.

## Rules and limits

- Ids (documents, blocks, comments, tokens, anchors) are opaque strings: take them from a result and pass them back unchanged.
- The registry owner is whoever created the registry context.
  Only the owner adds and removes managers, with `add_manager` and `remove_manager`; `get_owner` and `list_managers` read them.
- Group roles are `Admin` (full control), `Member` (what its capabilities allow) and `ReadOnly` (opens documents, cannot edit or comment).
  A folder Manager also holds group capabilities, which this tool set cannot set.
- A document title is at most 1024 characters, a block's text at most 100000 and a comment at most 10000; a write that goes past one is refused and nothing is stored.
- Retrying is safe only where a method says so.
- `create_doc`, `insert_block`, `split_block` and `add_comment` create a second item on a repeat, so after a lost response check `list_docs`, `list_blocks` or `list_comments` first.
- This tool set cannot set the default permissions the web app gives new members, delete a group, or move a group.
  A member invited from here cannot create folders: the node refuses their `create_group` until an admin grants them the permission in the web app.
- `set_group_metadata` replaces the whole record: a folder's name and `data.color`, or the namespace root's registry pin.
- `delete_doc`, `delete_block`, `delete_comment`, `delete_tag` and `delete_view` cannot be undone: confirm first.
