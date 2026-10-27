# Mero Chat for iOS

A native SwiftUI client for [Mero Chat](../../) on the same contract as the web
app (`com.calimero.chat`, [`logic/src/lib.rs`](../../logic/src/lib.rs)), built on
[MeroKit / MeroKitUI](https://github.com/calimero-network/swift-sdk).

## Delegated only

The phone holds no node and never talks JSON-RPC. It holds a device key that
your Calimero account certifies, and a relay runs the contract for it:

| What | How (SDK call) | Wire |
| --- | --- | --- |
| Sign in | `MeroClient.signInWithCloud` → wallet enrolment in the system auth sheet | wallet `account-enroll`, cloud `getAccountRelays` |
| Session | `CloudSignIn.keychain(service: "network.calimero.chat")` | device key, account session and relay tokens in the Keychain |
| Read a view (`get_messages`, `get_info`, `get_profiles`, `get_unread_count`) | `RelayClient.query` | `POST /admin-api/contexts/{id}/query` (account-scoped, Bearer) |
| Write (`send_message`, `edit_message`, `delete_message`, `update_reaction`, `set_profile`, `mark_as_read`) | `RelayClient.execute` | signed warrant, `POST /admin-api/contexts/{id}/intents` |
| List workspaces / channels | `AccountAdmin` reads | relay's caller-scoped admin API |
| Create a workspace | `CloudSignIn.foundNamespace` (+ `#general`) | governance intents (namespace founding), HA in the cloud |
| Create a channel | `AccountAdmin.createGroupInNamespace` + `createContext` | governance root op + `POST /admin-api/groups/{id}/context-intents` |
| Join an open channel | `AccountAdmin.joinContext` | `MemberJoinedOpen` governance intent |
| Invite | `CloudSignIn.createNamespaceInvitation` (signed with the device key) | none until redeemed |
| Join from an invitation | `CloudSignIn.join` | direct admission, `POST …/namespaces/{id}/admit` on the relay the cloud routes to |
| Live updates | `CloudConnection.mero.events(contextIds:)` | SSE on the relay with the account's Bearer session; polling every 5 s when no session is up |

There is no node login, no admin password and no "node URL" anywhere in the app.

Channels follow the web app's model: each channel is a subgroup of the
workspace's namespace with one context in it (subgroup visibility is the
public/private flag); a DM is the same with a `DM_CONTEXT_…` name and
`context_type: "Dm"`. History is paged with `get_messages(limit: 20, offset)`
like the web app, ordered by each message's stable `index`, with
`get_messages_from(start)` filling any gap after a burst. Invitation links are
the web app's (`https://links.calimero.network/com.calimero.chat/join?invitation=…`,
`base58(deflate({invitation, groupAlias}))`), so a link made on the web joins
here and the other way round.

## Design

The app draws Mero Chat the way the web app draws it below 1024px, from the
same tokens (`packages/glass/src/glass.css`, `app/src/index.css`), light and
dark, in Figtree (bundled, SIL OFL, `Resources/Fonts`):

- **Landing:** the header card, the hero and the ink "Continue with Calimero" pill.
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
channel (`AccountAdmin.uploadBlob` on the relay, calimero-network/swift-sdk#79)
and sent as `send_message`'s `images` / `files`. Images show as 80×80 tiles
that open full screen. Files are chips that download and open the share sheet.
Tap your picture in Settings to set it for the open channel
(`set_profile(username, avatar)`). Blobs are read through the channel's
context, so the relay can fetch one a peer holds.

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
LiveTests/           live tests: Sources/Core against a real relay (target MeroChatLiveTests)
```

## Build and run

Needs Xcode 16 (macOS 15) and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
brew install xcodegen
cd apps/mero-chat/mobile/ios
xcodegen generate
open MeroChat.xcodeproj          # run the MeroChat scheme on a simulator or device

# or from the command line, as CI does:
xcodebuild test -project MeroChat.xcodeproj -scheme MeroChat \
  -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO
```

Bundle id `network.calimero.chat`, iOS 16+. For a device build, set your team
in Xcode (Signing & Capabilities).

### The SDK pin

`project.yml` pins the package to a swift-sdk release, 0.4.0: the first one
with calimero-network/swift-sdk#79, which re-signs a join at schema 26 when the
admitting relay is on core 0.11.0-rc.90 and says so, and adds blob upload and
download for an account through the relay.

```yaml
packages:
  MeroKit:
    url: https://github.com/calimero-network/swift-sdk
    from: 0.4.0
```

To bump it, change `from` to the new version, run `xcodegen generate`, and let
Xcode re-resolve packages (File → Packages → Reset Package Caches if it holds on
to the old one).

## Live tests (a real relay)

`MeroChatLiveTests` runs the chat layer against a real merod relay, booted by
[`../e2e/run-relay.sh`](../e2e) (one node: embedded auth, device-key login,
delegated access, mock TEE, mero-chat installed). Nothing is faked but the
cloud: each test mints its accounts offline (a BIP39 root certifies a fresh
device key, as the wallet does), restores that session through `MeroClient`
exactly as `SessionModel` does, and drives `WorkspacesModel`,
`ChannelsModel` and `ChannelModel`:

| Case | Test | What it asserts |
| --- | --- | --- |
| Founder flow | `testFounderFlowAgainstTheRelay` | founding through the relay lists the workspace with its name and chat's app id; `#general` is created and joined; send ×3, paging back with `get_messages(limit: 2, offset)`, edit (stamped), react / un-react, delete (blanked, slot kept), `set_profile`, no unread |
| Invite + join | `testInviteJoinAndReplyAcrossTwoAccounts` | the app's invitation link parses back; a relayless second account redeems it at `/admit`, gains the relay, lists the workspace and `#general`, joins, reads the founder's message and replies; the founder sees an unread badge, the reply under Bob's name, and the badge clears; Bob's edit of Alice's message is not offered and is refused by the contract |
| Live update | `testBobsMessageReachesAlicesOpenChannelLive` | with `#general` open and live, Bob's message shows up in Alice's model while it is still on the SSE stream (not the polling fallback) |

They skip themselves unless `MERO_E2E_RELAY_URL` and `MERO_E2E_APP_ID` are
set, or `../e2e/.relay.env` exists, so the ordinary test run stays offline.
xcodebuild forwards only `TEST_RUNNER_`-prefixed variables to the test
process, so pass them that way:

```sh
cd apps/mero-chat/mobile/e2e && MEROD_BIN=/path/to/merod ./run-relay.sh   # writes .relay.env
cd ../ios && xcodegen generate
set -a; . ../e2e/.relay.env; set +a
TEST_RUNNER_MERO_E2E_RELAY_URL=$MERO_E2E_RELAY_URL TEST_RUNNER_MERO_E2E_APP_ID=$MERO_E2E_APP_ID \
  TEST_RUNNER_MERO_E2E_RELAY_ACCOUNT=$MERO_E2E_RELAY_ACCOUNT \
  xcodebuild test -project MeroChat.xcodeproj -scheme MeroChat \
  -destination 'platform=iOS Simulator,name=iPhone 16' -only-testing:MeroChatLiveTests CODE_SIGNING_ALLOWED=NO
```

Where the app would ask the cloud or the registry, the tests stand in:
`DelegatedChatBackend` takes the application to found with
(`MERO_E2E_APP_ID`, version `MERO_E2E_APP_VERSION`, default `0.0.0`) and the
relay to send joins to; both are `nil` in the app. The relay's own account
(the executor a founding warrant names, which the Cloud manager reports in
the app) is `MERO_E2E_RELAY_ACCOUNT`, which `run-relay.sh` writes; without it the rig
reads it once with the operator login (`MERO_E2E_RELAY_ADMIN_USER` /
`MERO_E2E_RELAY_ADMIN_PASSWORD`, default `dev` / `dev-password`). CI:
[`.github/workflows/mero-chat-ios-live.yml`](../../../../.github/workflows/mero-chat-ios-live.yml).

## Pointing it at another environment

`project.yml` sets these Info.plist keys; an empty value means the SDK default
(the hosted Calimero wallet, Cloud manager and registry):

| Key | Default | What |
| --- | --- | --- |
| `MeroWalletURL` | `https://wallet.cloud.calimero.network/account-enroll` | the wallet's enrolment page |
| `MeroCloudBaseURL` | `https://manager.cloud.calimero.network` | relay discovery, routing, HA |
| `MeroRegistryURL` | `https://apps.calimero.network` | where `com.calimero.chat` resolves |
| `MeroChatCallbackScheme` | `mero-chat` | the app scheme the wallet returns to (`mero-chat://enrol`) |
| `MeroChatCallbackHost` / `MeroChatCallbackPath` | unset / `/enrol` | a verified https callback instead (Associated Domains, iOS 17.4+) |

Edit them in `project.yml` and regenerate. The relay itself is not configured:
the Cloud manager names it for the account.

> The hosted wallet currently returns only to `https://` callbacks; app-scheme
> callbacks are a pending wallet change (see the swift-sdk README). Until it
> lands, sign-in against the hosted wallet needs `MeroChatCallbackHost` set to a
> domain the app has an Associated Domains entitlement for.

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

## When the relay is too old

A relay runs the chat the registry publishes for its runtime. The current
`com.calimero.chat` needs runtime 0.12.0-rc.1, so a relay on core
0.11.0-rc.90 can't install it: founding a workspace fails, and a channel
created on an older chat already installed there fails in its `init`. The app
says which: "Your relay runs Calimero 0.11.0-rc.90, which can't install this
version of Mero Chat…" (`ChatErrorText.outdatedRelay`). Nothing on the phone
can fix that; the relay has to be upgraded. Joining works on either release
(see the SDK pin).

## Not supported yet

- **Starting a DM**: DMs are listed and open like channels, but starting one
  needs the member directory and per-member metadata the web app writes; not
  built.
- **Presence** (typing, online dots): the SDK's `RelayPresenceClient` supports
  it; not used yet.
- **Workspace admin** (workspace roles, capabilities, remove members),
  **deleting a channel**, **leaving or deleting a workspace**: admin-API calls
  the backend does not make yet.
- **Notifications and push**: none while the app is closed.
- **More than one relay**: listings and contract calls go to the one relay the
  Cloud manager names for the account. A workspace served only by a different
  relay does not show up.
- **Universal links** for `https://links.calimero.network/…`: needs an
  Associated Domains entitlement on that domain. `calimero://com.calimero.chat/join?…`
  deep links open the app; https links can be pasted into **Join with a link**.
