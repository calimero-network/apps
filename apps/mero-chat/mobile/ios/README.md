# Mero Chat for iOS

A native SwiftUI client for [Mero Chat](../../) on the same contract as the web
app (`com.calimero.chat`, the component ABI in
[`logic/res/abi.json`](../../logic/res/abi.json), web port #730), built on
[MeroKit / MeroKitUI](https://github.com/calimero-network/swift-sdk).

## On Calimero 1.0

The phone holds no node and never talks JSON-RPC. It signs in to a Calimero
1.0 cluster with a passkey and talks to it over the sealed channel
(`calimero/sealed-http/v2`, opened only after the node's attestation is
verified). `SessionModel` drives MeroKitUI's `MeroClient`; `CloudChatBackend`
runs over the SDK's `CalimeroAppBackend`:

| What | How (SDK call) | Wire |
| --- | --- | --- |
| Sign in / create account | `MeroClient.connect(cluster:)` (a cluster name, nodes from the node directory) or `connect(nodeURL:allowMock:)`, then `signIn()` / `signUp(name:)` (a dev node: `signInOrSignUp`) | `/auth/passkey/{login,register}/{begin,finish}` |
| Session | `KeychainCloudSessionStore(service: "network.calimero.chat")`, `MeroClient.restore()` | session + refresh token in the Keychain, `/auth/refresh` |
| Read a view (`getMessages`, `getInfo`, `getProfiles`, `getUnreadCount`) | `ContextContract.query` through `ComponentChatContract` | a view on `/apps/{app}` |
| Write (`sendMessage`, `editMessage`, `deleteMessage`, `updateReaction`, `setProfile`, `markAsRead`) | `ContextContract.execute` through `ComponentChatContract` | a call on `/apps/{app}` |
| List workspaces / channels | `listNamespaces` / `listContextEntries(org)` + `listSubgroups` | the account's **orgs** running chat (`GET /auth/me`), the org's own app instances and its **teams** (`GET /orgs/{org}`) |
| Create a workspace | `foundNamespace` (+ `#general`) | `POST /orgs` + org metadata `{name, package}` |
| Create a channel | `createContext` (open), `createSubgroup` + `createContext` (private) | `POST /apps {package, org, access: org}`; private: `POST /orgs/{org}/teams {join: invite}` + `access: team` |
| Join an open channel | `joinContext` | open teams inherit org membership; `GET /apps/{app}` checks it |
| Invite | `createInvitation` | `POST /orgs/{org}/invites` → an invite token |
| Join from an invitation | `joinNamespace` | `POST /invites/{token}/redeem` |
| Live updates | `events(contextId:)` | `GET /apps/{app}/events` (sealed SSE); polling every 5 s once the stream ends |
| Attachments and avatars | `uploadBlob` / `getBlob` | `/apps/{app}/blobs` |
| Approvals (an update of Mero Chat, a node release) | `CalimeroClient.pendingApprovals(org:)` + `MeroClient.requestConsent(_:callback:confirm:)` (`ApprovalsModel`) | `POST /consent/requests` → the confirmation code on screen → the node's consent page in the system browser → `GET /consent/{id}/result` |

`ComponentChatContract` is the one place that knows the component ABI: the
rest of the app keeps v1's method names and shapes (`send_message`,
snake_case fields, numbers), and it sends camelCase names and arguments with
every `u64` (`timestamp`, `start`) as a decimal string, and reads answers back
the same way round, as the web's `src/api/meroChat.ts` does. A channel's
`init` takes the ABI's names directly (`name`, `contextType`, `description`,
`creatorUsername`). Accounts are the node's account ids, not base58 `UserId`s.

Channels follow the web app's model, in 1.0 terms: a workspace is an **org**;
an open channel is an **app instance** of chat in the org itself; a private
channel gets its own **team** that admits by invitation, with the instance in
it. A DM is an instance named `DM_CONTEXT_…` with `context_type: "Dm"`. History is paged with
`get_messages(limit: 20, offset)` like the web app, ordered by each message's
stable `index`, with `get_messages_from(start)` filling any gap after a burst.

### Sign-in

- **Calimero Cloud**: enter the cluster's name (its nodes come from the node
  directory) or one of its node URLs (bake one in with `CalimeroClusterURL`), then **Sign in
  with passkey** or **Create an account**. The node's TDX attestation is
  verified (`CloudPolicy.production`). The device's passkey needs the
  cluster's relying party as an associated domain (`webcredentials:<rp-id>`,
  see `project.yml`).
- **Development node**: a `merod local` node URL (default
  `http://localhost:2501`, `DefaultNodeURL`). The client allows mock
  attestation (`allowMock`) and makes and keeps a software passkey for that
  node.

### Invitations

`https://links.calimero.network/com.calimero.chat/join?invitation=<token>`, the
token being `base58(deflate(json))` of
`{"invitation":"inv_…","namespaceId":"…","name":"…"}` (the SDK's
`OrgInvitation`, the same payload kotlin-sdk writes). The invite token
is a bearer secret: anyone with the link can join until it expires. The web
app's own link (`https://<its origin>/?invite=inv_…`) and a bare `inv_…` token
open too: the node names the org when the token is redeemed. Pre-1.0 links
(signed group invitations) are refused.

### Approvals

Node releases and upgrades of an app instance are approved only on the node's
own consent page. The workspace picker lists what waits for the signed-in
person (updates of Mero Chat, node releases their org approves); **Review**
first shows the request's confirmation code, then opens the page in the system
browser, which shows the same code and returns to `mero-chat://consent`.

## Design

The app draws Mero Chat the way the web app draws it below 1024px, from the
same tokens (`packages/glass/src/glass.css`, `app/src/index.css`), light and
dark, in Figtree (bundled, SIL OFL, `Resources/Fonts`):

- **Landing:** a nav bar with the mark and "Mero Chat", the hero, a channel preview, the features, and sign-in pinned at the bottom (cluster URL and passkey, create an account, or a development node).
- **Workspace entry:** the web app's entry card (select, name yourself, create, join from a link).
- **Sidebar:** a full-screen panel with the logo, the workspace switcher,
  Browse Channels, CHANNELS (`#`, or a lock for a private channel) and DIRECT
  MESSAGES. Unread badges are the web app's: ink with the mention count, or a
  soft pill with the unread count.
- **Channel:** the solid nav bar (back, `# name ⚙`, search, invite, theme,
  settings); messages grouped as `Message/index.tsx` groups them, with
  avatars in the same palette and hash. Bubbles have a squared top-left
  corner, then "(edited)", the sent tick, reaction chips (yours on the wait
  color) and "N replies · 37 minutes ago".
- **Long-press:** the action bar (✅ 👍 😀, emoji, reply in thread, more) and
  the more menu (Reactions, Copy text, Edit message, Delete message).
- **Composer:** the white card with the B I U • 1. </> toolbar, the `@`
  mention list, the emoji picker and the "Draft" badge.
- **Overlays:** Thread, search, Settings, channel details with members and
  roles, invite, create channel, and the reactions list.

**Attachments and avatars** work as on the web. The composer's attach button
offers a photo (sent as JPEG, so a browser shows it) or a file from Files. A
message carries at most one image and one file, uploaded as blobs against the
channel's app instance (`/apps/{app}/blobs`) and sent as `send_message`'s `images` / `files`. Images show as 80×80 tiles
that open full screen. Files are chips that download and open the share sheet.
Tap your picture in Settings to set it for the open channel
(`set_profile(username, avatar)`). Blobs are read through the channel's app
instance.

Message bodies are the web editor's HTML, both ways: `ChatRichText.swift`
reads it into native text and writes the composer's marks back as the same
HTML, with mentions wrapped the way `markdownParser.ts` wraps them.

## Layout

```
project.yml          XcodeGen spec (the .xcodeproj is generated, not committed)
Sources/Core/        chat layer: contract calls, invitations, backend, view models (no SwiftUI)
Sources/App/         SwiftUI app: session, screens
Resources/Fonts/     Figtree (the web app's face) and its licence
Tests/               logic tests (compile Sources/Core directly, no host app)
SnapshotTests/       every screen drawn with sample data, light and dark (hosted in the app)
LiveTests/           live tests: Sources/Core against a real 1.0 node (target MeroChatLiveTests)
```

## Build and run

Needs Xcode 16 (macOS 15) and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
brew install xcodegen
cd apps/mero-chat/mobile/ios
xcodegen generate
open MeroChat.xcodeproj          # run the MeroChat scheme on a simulator or device

# or a device build from the command line (no simulator):
xcodebuild build-for-testing -project MeroChat.xcodeproj -scheme MeroChat \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO
```

Bundle id `network.calimero.chat`, iOS 16+. For a device build, set your team
in Xcode (Signing & Capabilities).

### The SDK pin

`project.yml` pins the package to the swift-sdk's `v0.5.0` release (its
Calimero 1.0 client).

```yaml
packages:
  MeroKit:
    url: https://github.com/calimero-network/swift-sdk
    exactVersion: 0.5.0
```

To bump it, change `exactVersion`, run `xcodegen generate`, and let Xcode
re-resolve packages (File → Packages → Reset Package Caches if it holds on to
the old one).

## Live tests (a real 1.0 node)

`MeroChatLiveTests` runs the chat layer against a real Calimero 1.0
development node (`merod local`: `--dev`, mock attestation) with chat
installed (`meroctl app install --path mero-chat.mpk`). Nothing is faked: each
test signs up its accounts with a software passkey over the sealed channel,
builds the backend exactly as `SessionModel` does, and drives
`WorkspacesModel`, `ChannelsModel` and `ChannelModel`:

| Case | Test | What it asserts |
| --- | --- | --- |
| Founder flow | `testFounderFlowAgainstTheNode` | founding lists the workspace with its name; `#general` is created and joined; send ×3, paging back with `get_messages(limit: 2, offset)`, edit (stamped), react / un-react, delete (blanked, slot kept), `set_profile`, no unread |
| Invite + join | `testInviteJoinAndReplyAcrossTwoAccounts` | the app's invitation link parses back; a second account redeems the invite token, lists the workspace and `#general`, joins, reads the founder's message and replies; the founder sees an unread badge, the reply under Bob's name, and the badge clears; Bob's edit of Alice's message is not offered and is refused by the contract |
| Live update | `testBobsMessageReachesAlicesOpenChannelLive` | with `#general` open and live, Bob's message shows up in Alice's model while it is still on the SSE stream (not the polling fallback) |

They skip themselves unless `MERO_E2E_NODE_URL` is set (optionally
`MERO_E2E_NODES`, `MERO_E2E_PACKAGE_VERSION`), so the ordinary test run stays
offline. xcodebuild forwards only `TEST_RUNNER_`-prefixed variables to the test
process (`TEST_RUNNER_MERO_E2E_NODE_URL=http://127.0.0.1:2501`). They have not
been run against a 1.0 node yet, and no CI job runs them (the old live relay
job is gone: relays do not exist on 1.0).

## Pointing it at another environment

`project.yml` sets these Info.plist keys:

| Key | Default | What |
| --- | --- | --- |
| `CalimeroClusterURL` | empty | the Calimero Cloud cluster's node URL; empty: the sign-in screen asks |
| `DefaultNodeURL` | `http://localhost:2501` | the development node the sign-in screen prefills |
| `MeroPackageVersion` | empty | the Mero Chat version new channels run; empty: the latest |
| `MeroChatCallbackScheme` | `mero-chat` | where the consent page returns (`mero-chat://consent`) |
| `MeroChatCallbackHost` / `MeroChatCallbackPath` | unset / `/consent` | a verified https return instead (Associated Domains, iOS 17.4+) |

Edit them in `project.yml` and regenerate.

## Snapshot tests

`MeroChatSnapshotTests` draws the sidebar, a channel, the landing page, the
workspace entry card and the dialogs with sample data in a window inside the
app, light and dark, and checks that each one draws. To look at them, pass
an output directory:

```sh
TEST_RUNNER_MERO_SNAPSHOT_DIR=/tmp/mero-chat-snaps xcodebuild test -project MeroChat.xcodeproj \
  -scheme MeroChat -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:MeroChatSnapshotTests CODE_SIGNING_ALLOWED=NO
```

## When the app instance is too old

A channel created against an older Mero Chat installed on the cluster fails
in its `init` (`unknown field \`context_type\``). The app says so
(`ChatErrorText.outdatedChat`); the app instance has to be upgraded, which
the owner approves on the consent page (see Approvals).

## Not supported yet

- **Starting a DM**: DMs are listed and open like channels, but starting one
  needs the member directory and per-member metadata the web app writes; not
  built.
- **Presence** (typing, online dots): 1.0 has `/apps/{app}/presence`; not used yet.
- **Workspace admin** (workspace roles, capabilities, remove members),
  **deleting a channel**, **leaving or deleting a workspace**: `MeroAppBackend`
  has the calls on 1.0, but the app doesn't offer them yet.
- **Notifications and push**: none while the app is closed.
- **More than one cluster**: the app signs in to one cluster at a time.
- **Universal links** for `https://links.calimero.network/…`: needs an
  Associated Domains entitlement on that domain. `calimero://com.calimero.chat/join?…`
  deep links open the app; https links can be pasted into **Join with a link**.
