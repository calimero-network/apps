# Mero Chat — native mobile apps

Native iOS and Android clients for Mero Chat, next to the web frontend (`../app`) and the
contract (`../logic`, package `com.calimero.chat`).

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | [`ios/`](ios/README.md) | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at a commit, by SPM revision in `ios/project.yml` |
| Android | [`android/`](android/README.md) | Jetpack Compose + Material3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `v0.2.0` (not on Maven Central), composite build at the SHA in `android/kotlin-sdk.ref` |

Both pins are SDK releases (kotlin-sdk is not on Maven Central, so Android builds it from source).
To bump: iOS, the `exactVersion` / `exact:` values; Android, `kotlin-sdk.ref` (the new tag's commit).

## On Calimero 1.0

Both apps sign in to a Calimero 1.0 cluster with a passkey and talk to it over the SDKs' sealed
channel. They call the component contract the web port (#730) ships in `../logic/res/abi.json`.

- **Sign in:** **Calimero Cloud** opens Mero Chat's sign-in page in the system sheet (the web
  app's own sign-in), where the person signs in or creates an account with their passkey. **Development node** takes a
  `merod local` URL and trusts its mock attestation, with a software passkey kept per node.
- **Contract:** `ComponentChatContract` (both platforms) is the one place that maps v1's method
  names and shapes to the ABI's: camelCase names and fields, `u64`s as decimal strings, as the
  web's `src/api/meroChat.ts` does. Errors are `422 APP_ERROR` (`Invalid`, `Forbidden`,
  `NotFound`, `Banned`), shown with the contract's own message.
- **Workspaces** are orgs. **Channels** are app instances of chat: open ones in the org itself (as
  the web makes them), private ones in a team that admits by invitation. Accounts are the node's
  account ids (v1 used base58 `UserId`s).
- **Invitations** are org invite tokens (minting is a passkey step-up). Links are the SDKs'
  `OrgInvitation` form; the web app's `?invite=inv_…` links and bare tokens open too.
- **Approvals:** releases and Mero Chat upgrades that wait for the account. Review shows the
  request's confirmation code, then opens the node's consent page in the system browser, which
  returns to `mero-chat://consent`.
- **Live updates:** the app instance's event stream, with polling of the open channel as the
  fallback.

## What both apps do

Sign in / out with the session kept in the platform keystore; list, create and join workspaces
and share invitation links; approvals; list and create channels and join open ones; list and open existing DMs;
paged message history, send, edit and delete your own messages, reactions, your display name
(`set_profile`), unread counts and mark-as-read.

iOS also has the web app's phone design (light and dark), threads, mentions, search, drafts,
channel roles and moderation, image and file attachments, profile pictures, and reads and writes
message bodies as the web editor's HTML. Android does not have these yet.

Not yet on either: starting a DM, presence, push notifications. Each
README lists them with the reason.

## Open points

- **Sign-in on Calimero Cloud** runs on Mero Chat's served page in the system sign-in sheet
  (`#native-sign-in`), which returns an app-bound session to `mero-chat://signed-in`.
  - **iOS:** `MeroClient.signInWithServedPage` (swift-sdk, pinned to a commit until released).
  - **Android:** not wired yet (kotlin-sdk, Custom Tabs).
  - Development nodes use software passkeys and need none of this.
- **Blobs** (attachments, avatars) need a node past core `1.0.0-rc.7` (#730).
- **Links across clients:** the web app shares `?invite=` links to its own origin and does not
  read the `links.calimero.network` form the phones share.

## CI

`.github/workflows/mero-chat-ios.yml` (macOS: XcodeGen, simulator build + unit tests) and
`.github/workflows/mero-chat-android.yml` (fetch the SDK, ktlint, detekt, unit tests, Android
lint, `assembleDebug`), each path-filtered to its folder. `ci.yml` does not scope `mobile/`. The
live relay suites are gone: relays do not exist on 1.0.
