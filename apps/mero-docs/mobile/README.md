# Mero Docs: native mobile apps

Native iOS and Android readers for Mero Docs, next to the web editor (`../app`) and the
contract (`../logic`, package `com.calimero.mero-drive-docs`, services `docs` and `registry`).
They have the same screens, copy, icons (SF Symbols and the matching Material icons) and behaviour.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `122bb0d7` (`feat/app-session`, PR #84) |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0999426` (`feat/app-session`, PR #67), composite build from `android/kotlin-sdk.ref` |

**The pins move to the merge commits once those two SDK PRs merge.** On iOS that means
`ios/project.yml` and `ios/DocsCore/Package.swift`; on Android, `android/kotlin-sdk.ref`.

## Read and comment

The phone reads documents and discusses them; writing stays on the web, where the BlockNote
editor and its CRDT binding live. What both apps do:

- **Sign in** with a Calimero account (`MeroAppSession`): the wallet certifies the phone's key.
  The session is kept in the Keychain / Keystore and restored at launch.
- **Workspaces**: the account's namespaces running Mero Docs. Pull to refresh.
- **Workspace**: search, **Recent** (the documents this phone opened last here, kept on the phone
  as the web keeps them in `localStorage`), the top-level **Folders**, and **Recently updated**
  (every document, newest change first: the web's Home table). Swipe a document to share its link.
- **Search**: titles match as you type; then every folder's `search_docs` (the node's full-text
  index of titles and bodies, best match first) adds hits with the node's snippet, matched words
  in bold.
- **Folder**: its subfolders and documents. Folders are the workspace's subgroups, nested by
  core's tree and walked level by level, each with one docs context, as `lib/coreFolders.ts`
  reads them. An open folder this account is not in yet is joined (`joinContext`), as the web's
  index does; a restricted one it cannot join says so.
- **Document**: the body drawn natively and read-only (see below), with the folder, last change
  and author, an archived banner, and the ids behind a Details disclosure. Live: it follows the
  relay's event stream, or polls every 5 s when the relay cannot stream. Long-press a block to
  comment on it, copy a link to it, or copy its text. A link to another document opens it here;
  a mention shows as the member; other links open in the browser.
- **Comments**: a sheet with every thread, or one block's. Comment on the document or on a block,
  reply to any comment (replies nest under their thread). Blocks with comments carry a lime count
  badge that opens their threads.
- **Share**: the web's own link, `https://mero-docs.vercel.app/app/<workspace>/f/<folder>/d/<doc>`
  (with `#b=<block>` for one block), so it opens in the web app and in these apps. Android offers
  the app for those links; iOS opens them once the domain publishes an associated-domains file.

Not on the phone: editing a document or its title, creating or moving documents and folders,
tags, archive, saved views, members, roles and sharing settings, presence cursors. Invitations
are not redeemed on the phone; an invitation link shows a note to accept it on the web or desktop.

## How a document is drawn

`get_document` returns the body already merged by the contract's rich-text CRDT: a flat list of
blocks (kind, depth, string attributes) whose text is runs of equally formatted characters. The
web feeds the same rows to BlockNote (`lib/rich/blocknote.ts`, `lib/rich/attributes.ts`); the
apps port only that read path (`DocumentReader`, the same code and the same test cases on both
platforms) and draw the blocks natively. No CRDT or web view runs on the phone.

Drawn: paragraphs, headings (levels 1 to 3), bullet, numbered and check lists (with nesting and
BlockNote's numbering), quotes, code blocks, images (the `blob:` reference read through the
account's relay), dividers, alignment and BlockNote's text and background colours; inline bold,
italic, underline, strike, code, colours and links. Any other block kind shows the web's notice,
"This block needs a newer version of Mero Docs."

`get_document` is read through the bound contract and decoded leniently rather than with the
generated `getDocument`: the node writes a span's `"true"` marks back as JSON booleans and leaves
`attributes` off a plain span, which the ABI's `map<string,string>` does not describe, so the
generated decoder would refuse every formatted document. Every other call uses the generated client.

## Comments on blocks

The contract's comments are flat and per document (`add_comment(doc_id, body)`,
`list_comments`), with no block or parent field, and the web app has no comments UI yet. The apps
set the convention: a comment on a block starts its body with `[[block:<block id>]]`, a reply with
`[[reply:<comment id>]]`, then a space and the text. A body with neither is a comment on the whole
document, so anything that reads the raw body still sees the words.

## Delegated execution only

Neither app runs or logs into a node. `MeroAppSession` signs in, finds the account's relay, and
gives a `MeroAppBackend`: namespaces, subgroups, membership and events go through it, contract
reads through the relay's query and writes as signed warrants. Each folder's docs context is
called as the account, as the web's per-folder clients are. Images are read with the signed-in
client's `admin.getBlob(blobId, contextId)`, because `MeroAppBackend` has no blob call yet.
Authors show as "You" or a short id: the relay has no member-name call.

## Generated contract client

`DocsClient` is generated from `../logic/res/abi.json` with the SDK's `ContextContractCalling`
(`--transport-import`), so it takes `contract.bound(to:)` directly; never edit it by hand:

- iOS: `ios/DocsCore/Sources/DocsCore/Generated/DocsClient.swift`
- Android: `android/app/src/main/kotlin/network/calimero/docs/generated/DocsClient.kt`

After a contract change, regenerate both with `scripts/regenerate-client.sh` (set `ABI_CODEGEN`
to an abi-codegen `dist/cli.js` that has the `swift` and `kotlin` targets) and commit the result.
Views go through the bound contract's `query`, writes through `execute`.

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

Sign-in returns to `mero-docs://enrol`. Point the apps at another environment with the
`MeroCloudBaseURL` / `MeroWalletURL` / `MeroRegistryURL` Info.plist keys in `ios/project.yml`, or
`-PmeroCloudUrl=` / `-PmeroWalletUrl=` / `-PmeroRegistryUrl=` / `-PmeroEnrolCallback=` on Android.
The hosted wallet currently returns only to `https://` callbacks, so production sign-in needs that
wallet change or a verified https callback (as in Mero Chat).

CI: `.github/workflows/mero-docs-ios.yml` (DocsCore tests on macOS, simulator build) and
`.github/workflows/mero-docs-android.yml` (ktlint, detekt, unit tests, Android Lint,
`assembleDebug`), each path-filtered to its folder.
