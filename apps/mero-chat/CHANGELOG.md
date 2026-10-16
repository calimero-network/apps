# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Settings offers a workspace admin **Delete workspace** and everyone else
  **Leave workspace**, never both. Leave was gated on `!isAdmin`, and `isAdmin`
  is false until the role is read and when the read fails, so an admin was
  shown Leave and had no way to delete. Neither control shows until the role is
  known; an account session's admin gets no Delete, which core has no account
  form of.

### Changed

- The bundle lists `https://mero-chat-pwa.vercel.app` in `frontend-aliases`. A
  node's sign-in page (auth-frontend v1.3.9, core 0.11.0-rc.86) trusts a login
  callback from an alias too, so a node or Calimero Desktop launcher still
  opening chat at its old address signs in instead of failing with "Login
  callback destination is not allowed". Clients still open only
  `links.frontend`.
- The bundle's `links.frontend` is `https://chat.hyperfeed.me`, where chat is now
  served. A node's sign-in page trusts the login callback only at that origin, so
  a hosted login from chat.hyperfeed.me failed with "Login callback destination is
  not allowed" while the bundle still named mero-chat-pwa.vercel.app.
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
