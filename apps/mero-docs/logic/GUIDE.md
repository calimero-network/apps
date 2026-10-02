# Mero Docs

## Overview

Mero Docs is a shared document workspace.
A workspace holds folders, and each folder holds rich-text documents.
A document is a title plus an ordered list of blocks (paragraph, heading, bullet item, image), each with its own formatted text.

The bundle has two services, and every context runs exactly one of them:

- `registry` is the workspace's table of contents: the folder tree, which docs context belongs to which folder, folder colours and names, roles, managers, tags and saved searches.
- `docs` holds the documents, comments and document tags of one folder.

`describe_app` and `select_app` show one service's methods at a time: pass `service` to `describe_app` (`registry` or `docs`), or pass a `context` to `select_app` and the service follows from the context.
mero-mcp generates no per-method tools for a bundle with two services, so run every method with the `call` tool, passing the `app_handle` from `select_app`, the `method` name and its `args` keyed by parameter name.

## Context model

- A workspace is a namespace.
  `create_namespace` makes it, and the namespace id is also the id of its root group.
- The workspace has exactly one `registry` context, created inside the root group (pass the namespace id as `group`) with the name `Registry`.
  Never create a second one: the web app would have to guess which is real.
- A folder is a group inside the namespace, and its group id is the folder id.
  A subfolder is a group created with `parent` set to the folder's group id.
- Every folder has exactly one `docs` context, created inside the folder's own group (pass the folder's group id as `group`) with the folder's name.
  This is the rule agents most often get wrong: one docs context per folder, never one per document, and never a docs context in the root group.
- Documents live inside their folder's docs context.
  Two documents in one folder share a context; documents in different folders never do.
- The registry row for a folder (`get_folders`) is the link between the two: its `id` is the group id and its `context_id` is the docs context.
  `register_folder` creates the row and `bind_folder_context` sets `context_id`, once.
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
3. `select_app` with `app` set to the package and `context` set to the registry context id, then `call` `get_folders`.
4. Each row gives `id`, `parent_id` (the tree), `alias` (the name), `color` and `context_id` (the docs context).
   A `parent_id` of `null` is a top-level folder.
5. `select_app` with `context` set to a folder's `context_id` to work in that folder's documents.

### Create a folder

Do the steps in this order, and stop at the first failure.

1. `create_group` with `namespace`, `visibility` (`open` or `restricted`) and, for a subfolder, `parent` set to the parent folder's group id.
   Leave `name` out.
   Keep the returned `groupId`: it is the folder id.
2. `set_group_metadata` with `group` set to the folder id and `name` set to the folder name.
   Naming after the visibility is set keeps the name readable to every workspace member of an open folder.
3. `create_context` with `application`, `group` set to the folder id, `service` set to `docs` and `name` set to the folder name.
   It takes no `args`.
   Keep the returned `contextId`.
4. With the registry handle, `call` `register_folder`:

   ```json
   {"id": "<folder id>", "parent_id": null, "color": "#3b82f6", "alias": "<folder name>"}
   ```

   Set `parent_id` to the parent folder's id for a subfolder.
   `color` is `#rrggbb` or `null`.
5. `call` `bind_folder_context` with `folder_id` set to the folder id and `context_id` set to the docs context id.

The web app refuses folders nested deeper than 8 levels and names longer than 128 characters; stay within both.
If step 4 or 5 answers that the id is taken or the folder is already bound, an earlier attempt landed: read `get_folder` and carry on rather than repeating.
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
`create_doc` and `insert_block` mint a new item on every call, so after a lost response check `list_docs` or `list_blocks` before repeating.

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
- `get_block` returns one block the same way, or `null`; `get_text` returns one block's plain text; `get_title` returns the title.
- `search_docs` with `query`, `include_archived`, `cursor` and `limit` finds documents by title and body words, best match first.
  Pass `null` as `cursor` and `limit` for the first page of 20, then the returned `next_cursor`.
  The query is at most 256 bytes.
  A node running with search off answers with an error; read `list_docs` and `get_document` instead.

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
- `add_comment` mints a new comment on every call, so check `list_comments` before repeating.
- A member who is Read only on the folder cannot comment.

### Archive and delete a document

- `archive_doc` hides a document from `list_docs`; `unarchive_doc` brings it back.
  Nothing is lost.
- `delete_doc` removes the document, its body and its comments for good.
  Only its creator or a moderator (the member who created the folder's docs context) may; `can_delete` on the `list_docs` row says whether you may.

### Rename or recolour a folder

- Rename: `set_group_metadata` with the folder id and the new `name`, then the registry's `set_folder_alias`, so members who cannot read a restricted folder still see the name.
- Recolour: `set_color` with `#rrggbb`, or an empty string to clear.
- Both registry calls work only for the member who registered the folder.

### Remove a folder

1. Remove subfolders first, deepest first.
2. With the registry handle, read the docs context id from `get_folder_context`, then `unregister_folder` with the folder id.
3. `delete_context` with that docs context id.
   This removes the context and its documents from this node.

This tool set cannot delete the folder's group, so the empty group stays in the namespace.
There is no tool to move a folder under another parent: the registry's `move_folder` changes only the registry's record, not the group tree, so do not use it.

### Invite someone and share folders

1. On your node, `invite_to_namespace` with the namespace id.
   Hand the whole returned object to the invitee.
2. On the invitee's node: `join_namespace` with `namespace`, the object's `invitation` field as `invitation` passed through unchanged, and its `groupName` as `groupName`.
   Passing the whole object as `invitation` is refused.
   The answer's `memberAccount` is the invitee's account id, which the inviter needs to assign roles.
   Then `join_context` with the registry context id.
3. For every folder the invitee should open, top-down so a subfolder follows its parent: for an `open` folder, `join_open_group` with the folder's group id, then `join_context` with the folder's `context_id` (from `get_folders`).
4. A `restricted` folder cannot be self-joined: an admin of the folder's group calls `add_group_members` with `group` set to the folder id and `members` set to `[{"identity": "<account id>", "role": "Member"}]`, and only then does the invitee call `join_context`, which otherwise hangs until it times out.

### Make a member Read only on a folder

A Read only member can open the folder's documents but not change them or comment; the node refuses each write.
The node enforces core's `ReadOnly` group role, not the registry role, so do both steps.

1. In the registry, a registry admin calls `set_folder_role` with `folder_id`, `member` and `role` set to `Viewer`.
2. An admin of the folder's group calls `add_group_members` with `group` set to the folder id and `members` set to `[{"identity": "<account id>", "role": "ReadOnly"}]`.
   This adds the row or changes an existing one.
3. Repeat both steps for every `open` sub-folder reached from this folder through `open` folders only.
   A `restricted` sub-folder keeps the member's own role there.
   This tool set cannot read a group's visibility, so go by the visibility each folder was created with.

To end it, do the same steps with `Editor` and `Member`.

## Rules and limits

- Ids (documents, blocks, comments, tokens, anchors) are opaque strings: take them from a result and pass them back unchanged.
- The registry owner is whoever created the registry context.
  The owner adds and removes managers with `add_manager` and `remove_manager`; owner and managers are the registry admins, who set folder roles and can remove any folder.
- Only the account that registered a folder can change it or bind its context, so create a folder and register it from the same account.
- `set_folder_role` records `Viewer` (Read only in the web app), `Editor` (the default) or `Manager` for a member on a folder.
  On its own it stops nothing: a write is refused only for a member whose role in the folder's group is `ReadOnly`, as under "Make a member Read only on a folder".
  The web app also sets the member's group capabilities, which this tool set cannot, so `Manager` set from here does not let the member manage the folder.
- Tags, colours and names have the limits stated on their methods; a value outside them is refused.
- A document title is at most 1024 characters, a block's text at most 100000 and a comment at most 10000; a write that goes past one is refused and nothing is stored.
- Retrying is safe only where a method says so.
- `create_doc`, `insert_block`, `split_block` and `add_comment` create a second item on a repeat, so check `list_docs`, `list_blocks` or `list_comments` first.
- `register_folder` and `bind_folder_context` fail on a repeat because the first attempt landed, so read `get_folder` instead.
- This tool set cannot set the default permissions the web app gives new members, delete a group, or move a group.
  A member invited from here cannot create folders: the node refuses their `create_group` until an admin grants them the permission in the web app.
- `set_group_metadata` replaces the whole metadata record.
  On a folder that is only the name; on the namespace root it carries the registry pin from Getting started.
- `delete_doc`, `delete_block`, `delete_comment`, `delete_tag` and `delete_view` cannot be undone: confirm before running them.
