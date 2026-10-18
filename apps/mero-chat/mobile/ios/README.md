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

## Layout

```
project.yml          XcodeGen spec (the .xcodeproj is generated, not committed)
Sources/Core/        chat layer: contract calls, invitations, backend, view models (no SwiftUI)
Sources/App/         SwiftUI app: session, screens
Tests/               logic tests (compile Sources/Core directly, no host app)
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

The delegated parity work in swift-sdk is unreleased, so `project.yml` pins the
package to an exact commit of its default branch:

```yaml
packages:
  MeroKit:
    url: https://github.com/calimero-network/swift-sdk
    revision: 2316394831440c80318f72c44e3a6e394ac2b57d
```

To bump it, change `revision` to the new commit, run `xcodegen generate`, and
let Xcode re-resolve packages (File → Packages → Reset Package Caches if it
holds on to the old one). Once swift-sdk tags a release with this surface,
replace `revision:` with `from: <version>`.

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

## Not supported yet

- **Threads** (replies, `parent_message`): the contract and the API layer
  support them; there is no thread screen.
- **Attachments and avatars**: blob upload/download is not wired; messages with
  attachments say so.
- **Creating DMs**: DMs are listed and open like channels, but starting one
  needs the member directory and per-member metadata the web app writes; not
  built.
- **Search, drafts, mentions, roles/moderation, channel settings, leaving**: not
  in the mobile MVP.
- **Presence** (typing): the SDK's `RelayPresenceClient` supports it; not used.
- **More than one relay**: listings and contract calls go to the one relay the
  Cloud manager names for the account. A workspace served only by a different
  relay does not show up.
- **Universal links** for `https://links.calimero.network/…`: needs an
  Associated Domains entitlement on that domain. `calimero://com.calimero.chat/join?…`
  deep links open the app; https links can be pasted into **Join with an invitation**.
