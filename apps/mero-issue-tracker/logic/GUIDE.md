# Mero Issue Tracker

## Overview

Mero Issue Tracker is a private issue board for a small engineering team.
Issues use a structured format built for handing a bug to a coding agent:

- `summary`: what is wrong, in one or two sentences.
- `impact`: who or what it affects and how badly.
- `repro`: the steps, logs or conditions that trigger it.
- `resolution_criteria`: what "fixed" must satisfy.

Each issue also has a `title`, a `status`, a `priority`, an optional `assignee`, `labels` and a comment thread.

- Statuses, in board column order: `Open`, `In progress`, `Blocked`, `Done`. New issues start `Open`.
- Priorities: `low`, `medium`, `high`, `urgent`.
- Issue ids look like `issue-1727000000000-1a2b3c4d`, comment ids like `comment-1727000000000-5e6f7a8b`; both are assigned by the contract.
- `created_at` and `edited_at` are unix milliseconds. `created_by` and comment `author` are the writer's device key (64 hex).

## Context model

- A workspace is a namespace of this app.
- A repo is one context in the workspace namespace, running the service `issue-tracker`. It holds that repo's issues, comments, labels and its `repo_url`.
- A repo's name is the context's `name`, which `list_contexts` shows. The node that added the repo also keeps a context alias of the same name; aliases are local to one node. Repo names are unique within a workspace.
- The service takes no init arguments; a new repo has an empty `repo_url` until `set_repo_url`.
- Every member of the workspace may read and triage every issue. Only a comment's author may edit or delete it, and only an issue's creator may delete it.

## Getting started

Every app tool (and `call`) takes an `app_handle`. Get one from `select_app` with `app` and `context`; the handle binds the repo the call runs against. Selecting another repo gives another handle; keep one per repo. The JSON examples in this guide show only the method's own arguments.

1. `list_applications` and find the package `com.calimero.mero-issue-tracker`.
2. `list_namespaces` and pick the workspace, or `create_namespace` with `application` set to the package and `name` set to the workspace name.
3. `list_contexts` for the application: the contexts whose `groupId` is the workspace namespace are its repos, and each one's `name` is the repo name.
4. If the repo you need does not exist, follow "Add a repo".
5. `select_app` with `app` set to the package and `context` set to the repo's context id; keep the returned `app_handle`.

To invite a teammate, `invite_to_namespace` for the workspace and hand over the invitation.
They run `join_namespace` on their node, then `join_context` with each repo's context id they need.

## Procedures

### Add a repo

1. Make sure no context of the workspace already has that `name` (Getting started step 3).
2. `create_context` with `application`, `namespace` set to the workspace namespace id, `service` `issue-tracker` and `name` set to the repo name, e.g. `apps`.
3. `select_app` with `app` set to the package and `context` set to the new context id.
4. Call `set_repo_url`:

   ```json
   {"url": "https://github.com/calimero-network/apps"}
   ```

5. `create_alias` with `alias` set to the repo name and `contextId` set to the new context id, so later calls on this node can name the repo. If the alias already exists, keep going.

### List repos

`list_contexts` for the application; the contexts whose `groupId` is the workspace namespace are its repos, named by `name`.
Select one and call `get_repo_info` with `{}` for its URL.

### File an issue

Call `create_issue`; it returns the new issue id:

```json
{"title": "Flaky CI", "summary": "The e2e job fails intermittently.", "impact": "Merges are blocked.", "repro": "Re-run the e2e job on main.", "resolution_criteria": "Ten consecutive green runs.", "priority": "high", "labels": ["ci"]}
```

### Find issues

`list_issues` filters by exact `status`, `assignee` and `label`; `null` means no filter.
Results are ordered by creation time.

```json
{"status": "Open", "assignee": null, "label": "ci"}
```

`get_issue` with `{"issue_id": "<issue id>"}` returns the issue and its comments.
`get_status_counts` with `{}` returns the count per column.

### Triage an issue

- Status: `set_status` with `{"issue_id": "<issue id>", "status": "In progress"}`.
- Priority: `set_priority` with `{"issue_id": "<issue id>", "priority": "urgent"}`.
- Assignee: `set_assignee` with `{"issue_id": "<issue id>", "assignee": "<account id>"}`; `null` clears it. The app suggests workspace members' account ids from `list_group_members`, but any text is accepted.
- Labels: `add_label` / `remove_label` with `{"issue_id": "<issue id>", "label": "ci"}`.
- Sections: `set_summary`, `set_impact`, `set_repro`, `set_resolution_criteria`, each with `issue_id` and the new text, e.g. `{"issue_id": "<issue id>", "summary": "Fails on every third run."}`.

### Discuss an issue

`add_comment` with `{"issue_id": "<issue id>", "body": "Seen again on main."}` returns the comment id.
The author may `edit_comment` with `{"comment_id": "<comment id>", "new_body": "Seen twice on main."}` or `delete_comment` with `{"comment_id": "<comment id>"}`.

### Delete an issue

As its creator, `delete_issue` with `{"issue_id": "<issue id>"}`. Its comments and labels go with it.

### Build a fix prompt

Call `get_issue` and `get_repo_info` on the repo, then give the coding agent: the issue id and title, the repository URL, the four sections under their own headings, and these instructions: reproduce first, find the root cause, make the smallest correct fix, add a regression test and prove every resolution criterion, then open a pull request with a test plan.

## Rules and limits

- `title` and each label: 1 to 64 characters. `summary`, `impact`, `repro`, `resolution_criteria` and comment bodies must not be empty.
- `status` and `priority` must be exactly one of the listed values; the status values are case-sensitive and `In progress` has a space.
- `repo_url` must start with `http://` or `https://`.
- Adding a label twice keeps one; removing a missing label succeeds.
- Deleting an issue removes it for every member; a delete that races an edit on another node is settled last-writer-wins.
- An issue belongs to one repo: to move it, file it again in the other repo and delete the original.
