# Mero Board

## Overview

Mero Board is a private kanban board for a team. A folder holds boards; a board holds lists (columns); a list holds cards. A card has a `title`, a `description`, an optional `assignee`, an optional `due_at`, `labels`, a checklist and a comment thread. Any member may edit, move, archive or relabel anything. Only a board's creator may delete the board, only a card's creator may delete the card, and only a comment's author may edit or delete the comment.

- Ids look like `board-1727000000000-1a2b3c4d`, `list-…`, `card-…`, `item-…`, `comment-…`; all assigned by the contract.
- `created_at`, `due_at` and `edited_at` are unix milliseconds. `created_by` and comment `author` are the writer's account id (64 hex).
- Order is a `rank`: a short string of `0-9a-z` that sorts lexicographically. Siblings (boards in a folder, lists on a board, cards in a list, checklist items on a card) are shown in `(rank, id)` order. To place something between two neighbours, pass a rank strictly between their ranks (`"i"` and `"r"` → `"n"`); omit `rank` to append last.

## Context model

- A workspace is a namespace of this app.
- A folder is one context in the workspace, running the service `board`. The context's `name` is the folder name. All of a folder's boards replicate to everyone who joined the folder. A team that wants boards nobody else sees uses another folder.
- The service takes no init arguments; a new folder has no boards.

## Getting started

Every app tool (and `call`) takes an `app_handle`. Get one from `select_app` with `app` and `context`; the handle binds the folder. Keep one handle per folder.

1. `list_applications` and find the package `com.calimero.mero-board`.
2. `list_namespaces` and pick the workspace, or `create_namespace` with `application` set to the package and `name` set to the workspace name.
3. `list_contexts` for the application: the contexts whose `groupId` is the workspace namespace are its folders, each one's `name` is the folder name.
4. If the folder you need does not exist, follow "Add a folder".
5. `select_app` with `app` set to the package and `context` set to the folder's context id; keep the returned `app_handle`.

To invite a teammate, `invite_to_namespace` for the workspace and hand over the invitation. They run `join_namespace` on their node, then `join_context` with each folder's context id they need.

## Procedures

### Add a folder

1. Make sure no context of the workspace already has that `name`.
2. `create_context` with `application`, `namespace` set to the workspace namespace id, `service` `board` and `name` set to the folder name, e.g. `marketing`.
3. `select_app` with `app` set to the package and `context` set to the new context id.
4. `create_alias` with `alias` set to the folder name and `contextId` set to the new context id. If the alias already exists, keep going.

### Create a board

`create_board` returns the board id. Then add lists with `create_list`, in the order you want them (omitting `rank` appends).

```json
{"name": "Q4 launch", "rank": null}
```
```json
{"board_id": "<board id>", "name": "Todo", "rank": null}
```

`list_boards` with `{"include_archived": false}` lists the folder's boards by rank. `rename_board`, `move_board` (`{"board_id", "rank"}`) and `set_board_archived` (`{"board_id", "archived"}`) change one.

### Read a board

`get_board` with `{"board_id": "<board id>"}` returns `{board, lists, cards}`: lists by rank and every card of the board by rank, archived ones included, each card with its `list_id`, `archived`, `labels` and `checklist_done` / `checklist_total`. Group cards by `list_id` to draw the columns and skip the ones with `archived: true` for the board view. A card whose `list_id` is empty or names no list of the board has lost its list; `move_card` puts it back.

### Add a card

`create_card` returns the card id. `description`, `assignee`, `due_at`, `labels` and `rank` are optional.

```json
{"board_id": "<board id>", "list_id": "<list id>", "title": "Write the launch post", "description": "Draft is in the shared doc.", "assignee": null, "due_at": 1767225600000, "labels": ["marketing"], "rank": null}
```

### Move a card

`move_card` with the target list (must be on the same board) and a rank between the new neighbours. The neighbours come from `get_board.cards` with that `list_id`, archived ones included, so a rank never collides with a hidden card. To put a card last in a list, use a rank after the last card's rank; to put it first, use a rank before the first card's.

```json
{"card_id": "<card id>", "list_id": "<list id>", "rank": "n"}
```

### Edit a card

`set_card_title`, `set_card_description`, `set_card_assignee` (`null` clears), `set_card_due` (`null` clears), `set_card_archived`, `add_label`, `remove_label`, each with `card_id` and the new value, e.g. `{"card_id": "<card id>", "assignee": "<account id>"}`. The app suggests members' account ids from `list_group_members`, but any text is accepted.

### Checklist

`add_checklist_item` with `{"card_id", "text", "rank"}` returns the item id. `set_checklist_item_done` with `{"item_id", "done"}` ticks it; `set_checklist_item_text`, `move_checklist_item` and `remove_checklist_item` edit, reorder and remove.

### Find cards

`list_cards` filters by exact `board_id`, `list_id`, `assignee` and `label`; `null` means no filter; `include_archived` hides or shows archived cards. Sorted by board then rank. `get_card` with `{"card_id"}` returns the card with its checklist and comments.

```json
{"board_id": null, "list_id": null, "assignee": "<account id>", "label": null, "include_archived": false}
```

### Discuss a card

`add_comment` with `{"card_id", "body"}` returns the comment id. The author may `edit_comment` with `{"comment_id", "body"}` or `delete_comment` with `{"comment_id"}`.

### Delete

`delete_list` with `{"list_id"}` fails while the list holds unarchived cards: move or archive them first. As the creator, `delete_card` with `{"card_id"}` or `delete_board` with `{"board_id"}`. A delete takes the shared rows and the caller's own comments with it; other people's comments (and, for a board, other people's cards) are not deleted but become unreachable.

## Rules and limits

- `name` and `title`: 1 to 64 characters. Labels: 1 to 32 characters. Comment bodies and checklist text must not be empty.
- A `rank` must be non-empty, use only `0-9a-z`, and not end in `0`.
- `move_card` and `create_card` reject a list that is not on the card's board. A card stays on its board; moving across boards is not supported.
- Adding a label twice keeps one; removing a missing label succeeds.
- Archiving hides; deleting removes. Archived boards and cards still answer `get_board` / `get_card` and `include_archived: true` queries; `get_board` always returns archived cards, flagged.
- Creator rights are enforced for honest members only. A board or card is owned through its creator's header, and a patched node can insert its own header at an existing board or card id. Honest readers pick the lowest account's header, so such a node can take over creator attribution and delete rights. A follow-up binds ids to their creators.
