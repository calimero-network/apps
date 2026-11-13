# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Workspaces and invites through the node's consent page** on Calimero Cloud.
  There Chat is served from its package's frontend origin, and since
  core#4934 a session opened there may not create an organization, mint an invite or redeem one (`403 FORBIDDEN: a session opened
  on an app's frontend can use that app only`), so "Create workspace" failed.
  Chat now asks the node (`/auth/me` names the session's app) and, for such a
  session, sends the person to the node's own consent page (core#5014), where
  they approve with their passkey after checking the code Chat showed:
  **Create workspace** (`createOrg`), **Invite** (`createInvite`, naming
  Chat's app team where the workspace has one) and **Join workspace**
  (`acceptInvite`). What Chat was doing waits in `sessionStorage` across the
  redirect; on the way back `ConsentReturn` reads the node's sealed decision
  (`resumeConsent`, never the return URL) and finishes: the new workspace is
  named, gets #general and is entered; the invite's link is shown; the joined
  workspace is entered. A decline changes nothing. A session opened on the
  cluster's own page, or on a dev node, does all three itself as before.
- Chat has its own **app team** in each workspace (core#4890). A new
  workspace gets one, open, so everyone in it has Chat as before; its open
  channels use the team's access, and an invite names the team. When the
  organization also holds other apps and an admin keeps their people apart
  (Calimero Home), a Chat invite gives Chat only, and says so; the workspace's
  member list, the people a channel reaches, and the people a private channel
  or DM can be started with are Chat's, not the whole organization's. Removing
  someone there takes them out of Chat (its team, and the private channels
  that list them), not out of the organization. An existing workspace stays as
  it is (organization access) until an admin gives Chat its own access list in
  Calimero Home; adding Chat to an organization whose apps have teams makes
  Chat's team first (owners and admins only).
- **Leave workspace** in an organization that keeps its apps apart leaves Chat
  only (its team), not the organization; when Chat was your last app there,
  it asks whether to leave the organization too. In open, standalone and
  legacy organizations Leave still leaves the organization. Chat's workspace,
  invite, member, remove and leave paths now go through
  `@calimero-apps/connect`'s shared org-app module, like every org app.

### Fixed

- Someone an admin takes out of Chat in Calimero Home (No in the People
  matrix) is out of the workspace in Chat too. Core shows a closed app team
  only to its members and the org's admins, so to them Chat's team was missing
  and the workspace read every org member as in Chat, themselves included; and
  the membership check never looked at the list, so an open workspace was never
  left. It now reads nobody in Chat there, and an open workspace leaves within
  a minute, as one removed from the organization does.
- Signing in no longer offers, preselects or enters an organization made for
  another app (a Mero Blocks world, say) as a chat workspace. The workspace
  list holds only the organizations that already hold chat; with none,
  **Create workspace** is the primary action. Putting chat into one of the
  account's other organizations is a separate, explicit choice, **Connect to
  an existing organization**, which lists each with what it holds and creates
  #general there when picked.

- Opening an invitation link and signing in now offers the invitation's
  **Join workspace**, and Join lands in the inviting workspace. The workspace
  picker, a full-screen overlay, came up beside the invitation prompt and
  covered it, so the person saw "Create workspace" (or their other workspaces)
  instead. The picker now waits until the invitation is joined, refused (which
  the prompt says), or turned down. A sign-up that joined through the link
  opens straight on that workspace's name step.

- Signing in with a passkey the cluster has no account for (made on another
  cluster, or before the cluster was recreated) now says so: "This passkey
  isn't known on this cluster: create a new passkey here, or use one you made
  on this cluster." The node's `401 unknown passkey` used to show as "Sign in
  first.", which read as if signing in itself was broken.
- Settings offers a workspace admin **Delete workspace** and everyone else
  **Leave workspace**, never both. Leave was gated on `!isAdmin`, and `isAdmin`
  is false until the role is read and when the read fails, so an admin was
  shown Leave and had no way to delete. Neither control shows until the role is
  known; an account session's admin gets no Delete, which core has no account
  form of.

### Changed

- A workspace created from the side menu starts with a public #general, as one
  from the first-run picker does. It used to start with no channels, so the
  creator landed in an empty workspace and an invitee had nowhere to land. If
  #general cannot be made, a toast says so and the workspace still opens.

- A member with no name gets a person icon instead of the first character of
  their account. The "3" from `3e76…db86` looked like a member count in the
  channel header and the members list. Settings shows the same icon.
- Creating a workspace from the side menu asks for your display name,
  prefilled with the one you use elsewhere, and publishes it as your member
  name. That path never set one, so you appeared as your shortened account.

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
