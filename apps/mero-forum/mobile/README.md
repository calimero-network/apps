# Mero Forum: native mobile apps

Native iOS and Android clients for Mero Forum, next to the web frontend (`../app`) and the
contract (`../logic`, package `com.calimero.mero-forum`). Both apps have the same screens, copy,
icons (SF Symbols on iOS, Material Icons on Android) and flows.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, XcodeGen | swift-sdk `c9ca1a0` (`main`, merge of swift-sdk#84) |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | kotlin-sdk `ea8ded7` (`main`, merge of kotlin-sdk#67), composite build |

The SDK pins are the `main` merge commits of the app-session PRs. To bump them, change
`revision:` in `ios/project.yml` and `ios/ForumCore/Package.swift` (keep the two identical), and
`android/kotlin-sdk.ref`.

## Delegated execution only

Neither app runs or logs into a node. Both are built on the SDKs' `MeroAppSession`: the person
signs in with their Calimero account (the wallet certifies this device's key), the Cloud manager
names the account's relay, and everything goes through that relay. Views go through the relay's
account-scoped query, writes are warrants the device key signs. Spaces are namespaces founded
through the relay; a forum is an open subgroup with one context running the contract, as on the
web. Live updates come from `MeroAppBackend.events(contextId)`, with a 10-second poll when the
relay cannot stream.

## Screens

1. **Sign in**: what Mero Forum is, and "Sign in with Calimero". An invitation that arrived while
   signed out is named here.
2. **Spaces**: your spaces as cards; New space, Join with a link, Account (name, account id
   behind Details, Sign out). Pull to refresh.
3. **Space**: its forums (Joined, or Open to join on the way in); New forum; Invite people (whole
   space), or long-press a forum to invite people straight into it.
4. **Forum timeline**: Latest / Top tabs; each post with avatar, name, `@handle` (short account
   id), age, title and text, and an action row (replies, up/score/down, share); a lime compose
   button; swipe to delete your own post or remove one as a moderator; infinite scroll.
5. **Post**: the post large with its full time stamp and counts, the replies under it
   ("Replying to @…"), a reply box that stays above the keyboard, edit/delete your own,
   moderator removal, vote on replies.
6. **Sheets**: compose / edit post, edit reply, new space / forum, join with a link, invitation
   link (share or copy), the invitation prompt (join, joining, joined, failed), and About this
   forum (your name in this forum, moderators, invite, ids behind Details).

## Features vs the web app

Same as the web: spaces, forums (create, list, join open ones), feed with Latest/Top and cursor
paging, posts, replies, votes on both, deleting your own, your display name (`set_nickname`,
kept on the device and pushed to each forum like the web's localStorage), invitation links in the
web's format both ways (`https://links.calimero.network/com.calimero.mero-forum/join?invitation=…`,
`calimero://…`, and the web's older `?invite=` links).

Beyond the web UI (the contract has them, the web app does not expose them): editing posts and
replies, moderation (moderators remove anyone's post or reply; moderators add and remove
moderators).

Left out, and why:

- **Deleting or leaving a space or forum, member roles, member counts per forum, TEE badges.**
  `MeroAppBackend` has no group-member, role or delete operations yet; the web does these through
  the node admin API.
- **Space-wide member names** (`@calimero-apps/names`): needs group metadata reads the backend does
  not expose; names come from each forum's contract instead.
- **Copy link to a post.** The web's post links point at the web build's own URL; the apps share
  the post's text instead.

## Generated contract client

The contract calls are generated, never hand-written: `ios/ForumCore/Sources/ForumGenerated/ForumClient.swift`
and `android/app/src/main/kotlin/network/calimero/forum/generated/ForumClient.kt`, from
`../logic/res/abi.json` with mero-devtools-js's abi-codegen. Regenerate both after a contract change:

```sh
ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate-client.sh
```

Each generated file declares its own `ContextContractCalling`; `ForumTransport` (both platforms)
adapts the SDK's `contract.bound(contextId)` to it.

## Build and test

iOS:

```sh
cd ios
swift test --package-path ForumCore      # logic and view-model tests, on macOS
xcodegen generate && open MeroForum.xcodeproj
```

The logic (generated client, view models, invitation codec, formatting) is the local `ForumCore`
SwiftPM package, so it builds and tests on macOS with no simulator; the SwiftUI app target links it.

Android:

```sh
cd android
./scripts/fetch-sdk.sh                   # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

The view-model tests on both platforms run against the SDKs' fakes (`InMemoryAppBackend`,
`RecordingContextContract`) and mirror each other test for test.

## Configuration

- **Sign-in callback**: `mero-forum://enrol` (iOS `MeroForumCallbackScheme` in `project.yml`,
  Android `meroEnrolCallback` in `gradle.properties`). The hosted wallet currently returns only to
  `https://` callbacks, so production sign-in needs that wallet change or a verified https
  callback, as for Mero Chat.
- **Environment**: empty values use the SDK defaults (hosted Cloud manager, wallet, registry).
  iOS: `MeroCloudBaseURL`, `MeroWalletURL`, `MeroRegistryURL` in `project.yml`. Android:
  `-PmeroCloudUrl=… -PmeroWalletUrl=… -PmeroRegistryUrl=…`.
- **Font**: Power Grotesk, converted from the web app's `app/public/fonts/powerGrotesk` WOFF2 files.

## CI

`.github/workflows/mero-forum-ios.yml` (macOS: `swift test` on ForumCore, then XcodeGen and an
unsigned simulator build) and `.github/workflows/mero-forum-android.yml` (fetch the SDK, ktlint,
detekt, unit tests, Android lint, `assembleDebug`), each path-filtered to its folder.
