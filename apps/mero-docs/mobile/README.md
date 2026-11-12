# Mero Docs: native mobile apps

Native iOS and Android readers for Mero Docs, next to the web editor (`../app`) and the
contract (`../logic`, package `com.calimero.mero-drive-docs`, one component on Calimero 1.0).
They have the same screens, copy, icons (SF Symbols and the matching Material icons) and behaviour,
and both run on Calimero 1.0: a passkey account on a Calimero Cloud cluster (or a development
node), its organizations as workspaces, their teams as folders.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `v0.5.0` |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0.4.0` (not on Maven Central), composite build from `android/kotlin-sdk.ref` |

**To bump a pin**, change it in every place it is set. On iOS that means
`ios/project.yml` and `ios/DocsCore/Package.swift`; on Android, `android/kotlin-sdk.ref`.

## Read and comment

The phone reads documents and discusses them; writing stays on the web, where the BlockNote
editor and its CRDT binding live. What both apps do:

- **Sign in** with a passkey on your Calimero Cloud cluster, or on a development node (see *How
  the apps reach Calimero*). The session is kept in the Keychain / encrypted preferences and
  restored at launch.
- **Workspaces**: the account's organizations running Mero Docs. Pull to refresh.
- **Workspace**: search, **Recent** (the documents this phone opened last here, kept on the phone
  as the web keeps them in `localStorage`), the top-level **Folders**, and **Recently updated**
  (every document, newest change first: the web's Home table). Swipe a document to share its link.
- **Search**: titles match as you type; then every folder's `searchDocs` (a word-prefix match on
  title and body, best match first) adds hits with the contract's snippet, matched words in bold.
- **Folder**: its subfolders and documents. Folders are the organization's teams, nested by their
  `parent`, each with one docs app instance whose id the team metadata keeps as `docsApp`, as
  `lib/coreFolders.ts` reads them from one `GET /orgs/{org}`. A Restricted folder this account was
  not invited to is not listed; one whose parent it cannot see sits at the top.
- **Document**: the body drawn natively and read-only (see below), with the folder, last change
  and author, an archived banner, and the ids behind a Details disclosure. Live: it follows the
  app instance's event stream, or polls every 5 s when it cannot stream. Long-press a block to
  comment on it, copy a link to it, or copy its text. A link to another document opens it here;
  a mention shows as the member; other links open in the browser.
- **Comments**: a sheet with every thread, or one block's. Comment on the document or on a block,
  reply to any comment (replies nest under their thread). Blocks with comments carry a lime count
  badge that opens their threads.
- **Share**: the web's own link, `https://mero-docs.vercel.app/app/<workspace>/f/<folder>/d/<doc>`
  (with `#b=<block>` for one block), so it opens in the web app and in these apps. Android offers
  the app for those links; iOS opens them once the domain publishes an associated-domains file.

- **Invitations**: an invitation link (Calimero 1.0's org invite token, in the SDK's
  `OrgInvitation` link shape) asks to join once someone is signed in, and redeems it
  (`POST /invites/{token}/redeem`); the workspace list reloads.
- **Approvals** (Account sheet): node releases and app upgrades waiting for you, per workspace and
  for your own apps. *Review* shows the request's confirmation code first, then opens the node's
  consent page in the system browser (a Custom Tab on Android), which returns to
  `mero-docs://consent`.

Not on the phone: editing a document or its title, creating or moving documents and folders,
tags, archive, saved views, members, roles and sharing settings, presence cursors.

## How a document is drawn

`getDocument` returns the body already merged by the contract's rich-text CRDT: a flat list of
blocks (kind, depth, string attributes) whose text is runs of equally formatted characters. The
web feeds the same rows to BlockNote (`lib/rich/blocknote.ts`, `lib/rich/attributes.ts`); the
apps port only that read path (`DocumentReader`, the same code and the same test cases on both
platforms) and draw the blocks natively. No CRDT or web view runs on the phone.

Drawn: paragraphs, headings (levels 1 to 3), bullet, numbered and check lists (with nesting and
BlockNote's numbering), quotes, code blocks, images (the `blob:` reference read as a blob of
the folder's app instance), dividers, alignment and BlockNote's text and background colours; inline bold,
italic, underline, strike, code, colours and links. Any other block kind shows the web's notice,
"This block needs a newer version of Mero Docs."

Each block's text is the contract's Fugue `RichText` for it, read as the web reads it: its
`spans` in order, each a run of equally formatted characters with its marks as strings (`"true"`
for a boolean mark). The reader takes a mark written as a JSON boolean, or a span without
`attributes`, the same way. The phone never writes body text, so the character `ids` are not read.

## Comments on blocks

The contract's comments are flat and per document (`addComment(docId, body)`,
`listComments(docId)`), with no block or parent field, and the web app has no comments UI yet. The apps
set the convention: a comment on a block starts its body with `[[block:<block id>]]`, a reply with
`[[reply:<comment id>]]`, then a space and the text. A body with neither is a comment on the whole
document, so anything that reads the raw body still sees the words.

## How the apps reach Calimero

Both apps talk to a node of a Calimero 1.0 cluster over the sealed channel
(`calimero/sealed-http/v2`, after the node's TDX attestation is verified) and sign in with a
passkey; they run no node. `MeroAppSession` builds the SDK's `CalimeroAppBackend`:

| Mero Docs | `MeroAppBackend` | Calimero 1.0 |
| --- | --- | --- |
| workspace | namespace | organization |
| folder | subgroup | team (its docs instance in team metadata `docsApp`) |
| folder's documents | context | app instance (`/apps/{app}/views`, `/intents`, `/events`) |
| image | blob | `/apps/{app}/blobs` (`MeroAppBackend.getBlob`) |
| invitation | `OrgInvitation` | org invite token, redeemed at `/invites/{token}/redeem` |

Sign-in (`ios/Sources/App/CloudAccess.swift`, `android/…/ui/CloudAccess.kt`):

- **Calimero Cloud:** your cluster by name (`eu-shared-1`: its nodes come from the Calimero Cloud
  directory and the client fails over between them) or by a node's URL, then *Sign in with
  passkey* or *Create an account*. Prefill it with `MeroNodeURL` in `ios/project.yml` or
  `-PmeroCluster=` on Android. The device's passkey belongs to the cluster's relying party: a real
  cluster needs the `webcredentials:<rp-id>` associated domain (iOS) or Digital Asset Links
  (Android).
- **Development node:** a `merod local` node (`MeroDevNodeURL`, `http://localhost:2501`; Android
  `-PmeroDevNodeUrl=`, `http://10.0.2.2:2501` from the emulator), mock attestation allowed, with a
  software passkey kept on the phone for it.
- Membership step-ups (joining by invitation) are approved with the account's passkey; on Android
  `MainActivity` hands the session its Activity's.

Authors show as "You" or a short id.

### The contract

`DocsClient` (`ios/DocsCore/Sources/DocsCore/Generated/`, `android/…/docs/generated/`) is
generated from the component ABI (`../logic/res/abi.json`) by core's `mero-app-build codegen`
(`scripts/mobile-codegen.sh` at the repo root; CI's `Mobile clients` workflow fails on a stale
one). The apps call the read and comment half of the web's typed adapter
(`../app/src/lib/docsApi.ts`): `listDocs`, `getDoc`, `searchDocs`, `getDocument`, `listComments`
and `addComment`, with camelCase arguments. Until the logic derives `AbiType` the client answers
their JSON, which `DocsShapes.swift` / `core/DocsShapes.kt` read: 64-bit values arrive as decimal
strings and timestamps in milliseconds; like the web adapter, they hand the screens nanoseconds. A
test on each platform checks every method, and `addComment`'s parameters, against `abi.json`
(skipped while that file is still the v1 ABI).

Errors read as words (`DocsFormat.errorText`): a cancelled passkey prompt, an ended session
(`LoginRequired`), a node that does not serve the account (`WrongNode`), an unavailable cluster, a
release deadline that paused new work, a stale consent request, the node's `403` for a read-only
member, and the contract's `APP_ERROR` codes (`NotFound`, `Invalid`, `Forbidden`).

## Build and test

iOS (Xcode 15+, `brew install xcodegen`):

```bash
cd ios
swift test --package-path DocsCore     # reader, comments, links, view models, on macOS
xcodegen generate && open MeroDocs.xcodeproj
```

Android (JDK 17, Android SDK 34):

```bash
cd android
./scripts/fetch-sdk.sh                 # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

iOS: the cluster is `MeroNodeURL` and the development node `MeroDevNodeURL` (Info.plist keys in
`ios/project.yml`). Android: `-PmeroCluster=` and `-PmeroDevNodeUrl=`. The consent page returns to
`mero-docs://consent` on both.

CI: `.github/workflows/mero-docs-ios.yml` (DocsCore tests on macOS, app build) and
`.github/workflows/mero-docs-android.yml` (ktlint, detekt, unit tests, Android Lint,
`assembleDebug`), each path-filtered to its folder.
