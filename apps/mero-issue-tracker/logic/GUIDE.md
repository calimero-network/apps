# Mero Issue Tracker

## Overview

Mero Issue Tracker is a private issue board for a small engineering team.
Issues use a structured format built for handing a bug to a coding agent:

- `summary`: what is wrong, in one or two sentences.
- `impact`: who or what it affects and how badly.
- `repro`: the steps, logs or conditions that trigger it.
- `resolutionCriteria`: what "fixed" must satisfy.

Each issue also has a `title`, a `status`, a `priority`, an optional `assignee`, `labels` and a comment thread.

- Statuses, in board column order: `Open`, `In progress`, `Blocked`, `Done`. New issues start `Open`.
- Priorities: `low`, `medium`, `high`, `urgent`.
- Issue ids look like `issue-1727000000000-1a2b3c4d`, comment ids like `comment-1727000000000-5e6f7a8b`; both are assigned by the contract.
- `createdAt` and `editedAt` are unix milliseconds as decimal strings. `createdBy` and a comment's `author` are the writer's account id.

## App model

- A workspace is an organization.
- A repo is one instance of this app (package `com.calimero.mero-issue-tracker`) in the workspace's organization, named after the repo. It holds that repo's issues, comments, labels and its `repoUrl`.
- `init` takes no arguments; a new repo has an empty `repoUrl` until `setRepoUrl`.
- Everyone the organization admits (owner, admins, members, guests) may read and triage every issue. Only a comment's author may edit or delete it, and only an issue's creator may delete it: anyone else gets `Forbidden`.

## Getting started

1. List the account's organizations and pick the workspace, or create one.
2. List the instances of the package in that organization: each one's `name` is a repo.
3. If the repo you need does not exist, follow "Add a repo".
4. Call the methods below on the repo's app id. Method and argument names are camelCase; 64-bit integers travel as decimal strings.

To invite a teammate, create an organization invite (a passkey step-up) and hand over the token; they redeem it after signing in.

## Procedures

### Add a repo

1. Make sure no instance in the workspace already has that name.
2. Create an instance of the package in the workspace's organization, named after the repo, e.g. `apps`.
3. Call `setRepoUrl` on it:

   ```json
   {"url": "https://github.com/calimero-network/apps"}
   ```

### List repos

List the package's instances in the organization; call `getRepoInfo` with `{}` on each for its URL.

### File an issue

Call `createIssue`; it returns the new issue id:

```json
{"title": "Flaky CI", "summary": "The e2e job fails intermittently.", "impact": "Merges are blocked.", "repro": "Re-run the e2e job on main.", "resolutionCriteria": "Ten consecutive green runs.", "priority": "high", "labels": ["ci"]}
```

### Find issues

`listIssues` filters by exact `status`, `assignee` and `label`; `null` (or leaving it out) means no filter.
Results are ordered by creation time, at most the first 1,000.

```json
{"status": "Open", "assignee": null, "label": "ci"}
```

`getIssue` with `{"issueId": "<issue id>"}` returns the issue and its comments.
`getStatusCounts` with `{}` returns the count per column.

### Triage an issue

- Status: `setStatus` with `{"issueId": "<issue id>", "status": "In progress"}`.
- Priority: `setPriority` with `{"issueId": "<issue id>", "priority": "urgent"}`.
- Assignee: `setAssignee` with `{"issueId": "<issue id>", "assignee": "<account id>"}`; `null` clears it. The app suggests workspace members' account ids, but any text is accepted.
- Labels: `addLabel` / `removeLabel` with `{"issueId": "<issue id>", "label": "ci"}`.
- Sections: `setSummary`, `setImpact`, `setRepro`, `setResolutionCriteria`, each with `issueId` and the new text, e.g. `{"issueId": "<issue id>", "summary": "Fails on every third run."}`.

### Discuss an issue

`addComment` with `{"issueId": "<issue id>", "body": "Seen again on main."}` returns the comment id.
The author may `editComment` with `{"commentId": "<comment id>", "newBody": "Seen twice on main."}` or `deleteComment` with `{"commentId": "<comment id>"}`.

### Delete an issue

As its creator, `deleteIssue` with `{"issueId": "<issue id>"}`. Its labels and its whole comment thread go with it.

### Build a fix prompt

Call `getIssue` and `getRepoInfo` on the repo, then give the coding agent: the issue id and title, the repository URL, the four sections under their own headings, and these instructions: reproduce first, find the root cause, make the smallest correct fix, add a regression test and prove every resolution criterion, then open a pull request with a test plan.

## Rules and limits

- `title` and each label: 1 to 64 characters. `summary`, `impact`, `repro`, `resolutionCriteria` and comment bodies must not be blank.
- `status` and `priority` must be exactly one of the listed values; the status values are case-sensitive and `In progress` has a space.
- `repoUrl` must start with `http://` or `https://`.
- Adding a label twice keeps one; removing a missing label succeeds.
- Errors are `{ code, fields }`: `NotFound { id }`, `Invalid { message }`, `Forbidden { message }`.
- An issue belongs to one repo: to move it, file it again in the other repo and delete the original.
