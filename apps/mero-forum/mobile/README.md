# Mero Forum: native mobile apps

Native iOS and Android clients for Mero Forum, next to the web frontend (`../app`) and the
contract (`../logic`, package `com.calimero.mero-forum`). Both apps have the same screens, copy,
icons (SF Symbols on iOS, Material Icons on Android) and flows.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, XcodeGen | swift-sdk `v0.5.0` |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | kotlin-sdk `0.4.0` (not on Maven Central), composite build |

The pins are SDK releases. To bump them, change `exactVersion` / `exact:` in
`ios/project.yml` and `ios/ForumCore/Package.swift` (keep the two identical), and
`android/kotlin-sdk.ref` (the new tag's commit).

## Calimero 1.0

Both apps talk to a Calimero 1.0 cluster through the SDKs' `MeroAppSession` / `MeroAppBackend`,
over the sealed channel to an attested node:

- **Sign-in**: Calimero Cloud, by cluster name (`eu-shared-1`, its nodes read from the Cloud
  directory) or by a node URL, then the device's passkey ("Create an account" registers a new one);
  or a **Development node** (`merod local`, mock attestation allowed, a software passkey kept on
  the device).
- **Spaces are organizations; a forum is an app instance of Mero Forum directly in the org**, as
  on the web (`createApp(name, source, { org })`). Every member of the org reaches its forums, so
  there is nothing to join and nothing waits to sync.
- **The contract** is the component port's (`../logic/res/abi.json`, web PR #715): camelCase
  methods and arguments (`createPost`, `postId`, `commentId`), camelCase answers with
  `createdAt` / `editedAt` / `score` / `commentCount` as decimal strings. Refusals are
  `APP_ERROR` `NotFound {what, id}`, `Forbidden {message}`, `Invalid {message}`, shown in plain
  words. The typed client, `ForumClient` (`ForumCore/Sources/ForumCore/Generated/` /
  `forum/generated/`), is generated from the ABI by core's `meroctl app codegen`
  (`scripts/mobile-codegen.sh` at the repo root; CI's `Mobile clients` workflow fails on a stale
  one). Until the logic derives `AbiType`, the ABI names the answer types without their shape, so
  `ForumContract.swift` / `contract/ForumContract.kt` keep them, with the method lists
  `ContractTests` checks against the committed ABI.
- **Invitations** are org invite links: the SDK's payload
  (`{invitation: "inv_…", namespaceId, contextId?, name, kind, forumId, forumName}`, in
  `https://links.calimero.network/com.calimero.mero-forum/join?invitation=…` or `calimero://`),
  redeemed with `POST /invites/{token}/redeem`. The web app's 1.0 link (`?invite=inv_…&forum=<app>`)
  opens too. Pre-1.0 links are refused.
- **Approvals**: newer Mero Forum releases and node releases that wait for the person show on
  Spaces. "Review" first shows the node's confirmation code, then opens the consent page in the
  system browser (Custom Tab on Android), which returns to `mero-forum://consent`.
- **Live updates** from `MeroAppBackend.events(contextId)`, with a 10-second poll when the stream
  is down.

## Screens

1. **Sign in**: what Mero Forum is, Calimero Cloud (cluster name or URL, passkey sign-in or
   create an account) or a development node. An invitation that arrived while signed out is named
   here.
2. **Spaces**: what waits for approval, your spaces as cards; New space, Join with a link, Account (name, account id
   behind Details, Sign out). Pull to refresh.
3. **Space**: its forums; New forum; Invite people (whole
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

Same as the web: spaces, forums (create, list), feed with Latest/Top and cursor
paging, posts, replies, votes on both, deleting your own, your display name (`set_nickname`,
kept on the device and pushed to each forum like the web's localStorage), org invitation links
(the SDK's, and the web's `?invite=` links).

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

## Build and test

iOS:

```sh
cd ios
swift test --package-path ForumCore      # logic and view-model tests, on macOS
xcodegen generate && open MeroForum.xcodeproj
```

The logic (typed contract client, view models, invitation codec, formatting) is the local `ForumCore`
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

- **Consent callback**: `mero-forum://consent` (iOS `MeroForumCallbackScheme` in `project.yml`,
  Android `meroConsentCallback` in `gradle.properties`; the manifest filter follows it).
- **Defaults**: the prefilled cluster and development node: iOS `CalimeroClusterURL` /
  `DefaultNodeURL` in `project.yml`; Android `meroCluster` / `meroDevNodeUrl`. Passkey sign-in on
  a real cluster needs the cluster's relying party as an associated domain (iOS) or Digital Asset
  Links (Android).
- **Font**: Power Grotesk, converted from the web app's `app/public/fonts/powerGrotesk` WOFF2 files.

## CI

`.github/workflows/mero-forum-ios.yml` (macOS: `swift test` on ForumCore, then XcodeGen and an
unsigned build) and `.github/workflows/mero-forum-android.yml` (fetch the SDK, ktlint,
detekt, unit tests, Android lint, `assembleDebug`), each path-filtered to its folder.
