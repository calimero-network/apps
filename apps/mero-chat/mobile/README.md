# Mero Chat — native mobile apps

Native iOS and Android clients for Mero Chat, next to the web frontend (`../app`) and the
contract (`../logic`, package `com.calimero.chat`).

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | [`ios/`](ios/README.md) | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI`, by SPM revision in `ios/project.yml` |
| Android | [`android/`](android/README.md) | Jetpack Compose + Material3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose`, composite build at the SHA in `android/kotlin-sdk.ref` |

## Delegated execution only

Neither app runs or logs into a node. The phone holds a device key that the person's account
certifies through the wallet/cloud enrolment, and everything else goes through the account's
relay:

- **Relay:** found with the Cloud manager's `getAccountRelays` after sign-in.
- **Reads:** the relay's account-scoped `POST /admin-api/contexts/{id}/query`.
- **Writes:** signed warrants on `POST /admin-api/contexts/{id}/intents`. Nothing calls `/jsonrpc`.
- **Workspaces:** founded as a namespace through the relay; joined from the web app's invitation
  links by direct admission (`POST /admin-api/namespaces/{id}/admit`).
- **Channels:** the web app's model — one subgroup per channel with one context in it, created
  through context intents.
- **Live updates:** the relay's event stream, with 5-second polling of the open channel as the
  fallback.

## What both apps do

Sign in / out with the session kept in the platform keystore; list, create and join workspaces
and share invitation links (the web app's `links.calimero.network/com.calimero.chat/join` format,
plus `calimero://`); list and create channels and join open ones; list and open existing DMs;
paged message history, send, edit and delete your own messages, reactions, your display name
(`set_profile`), unread counts and mark-as-read.

Not yet: threads, attachments and avatars, starting a DM, search, drafts, mentions, roles,
presence, push notifications. Each README lists them with the reason.

## Open points

- **Sign-in callback.** Both apps default to `mero-chat://enrol`. The hosted wallet currently
  returns only to `https://` callbacks, so production sign-in needs that wallet change or a
  verified https callback (iOS Associated Domains, Android App Links). See each README.
- **Unreleased SDKs.** Both pin the SDKs' default branches by commit, because the delegated layer
  is not in a tagged release yet. Bumping a pin is one line (see each README).

## CI

`.github/workflows/mero-chat-ios.yml` (macOS: XcodeGen, simulator build + unit tests) and
`.github/workflows/mero-chat-android.yml` (fetch the SDK, ktlint, detekt, unit tests, Android
lint, `assembleDebug`), each path-filtered to its folder. `ci.yml` does not scope `mobile/`.
