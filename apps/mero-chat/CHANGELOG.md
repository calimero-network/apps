# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `set_member_role` announces `RoleUpdated` only when the role changes. The app
  re-asserts an admin's own Admin role each time a channel opens, and each one
  used to reach Hyperfeed as "You are now Admin".
- `search_messages` answers from the node's full-text index: every message
  and reply, newest first, at a cost that does not grow with the channel. Hits
  carry no position; `message_position` gives it, and the app asks for it when
  a result is opened. The channel walk is now `search_messages_scan`, which the
  app calls where the node runs with search off.
- Search was `search_messages(query, cursor, limit)`: newest first, a bounded
  amount of work per call, slim hits with a snippet, and a cursor for the next
  page. Text is matched as it is shown and folded for case and accents.
  `search_all_messages` is removed; the app falls back to it for contexts still
  on an older version.
- The app searches every conversation a page at a time, merges the pages newest
  first, and "Load more" continues each conversation from its cursor. Opening a
  result jumps to the message.

[Unreleased]: https://github.com/calimero-network/calimero-curb-chat/releases
