# Mero Sign — native mobile apps

Native iOS and Android clients for Mero Sign, next to the web frontend (`../app`) and the
contract (`../logic`, package `com.calimero.mero-sign`). Both apps have the same screens, copy,
flows and (mapped) icons. Their job is the recipient's: **review and sign the agreements you were
sent.** Uploading documents, placing fields and the semantic search stay on the web.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, PDFKit | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `v0.5.0` (in `ios/project.yml`, `ios/SignCore/Package.swift` and `Package.resolved`) |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26, `PdfRenderer` + PdfBox-Android | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0.4.0` (`android/kotlin-sdk.ref`, composite build) |

Both pins are SDK releases; bump them to the next release together.

## Calimero 1.0

Neither app runs a node. Both sign in with a **passkey** on the workspace's cluster (or create an
account), over the sealed channel to an attested node, and lay things out exactly as the web app
does (`app/src/lib/agreements.ts`, web port #726):

| Mero Sign | Calimero 1.0 |
| --- | --- |
| workspace | organization |
| agreement | app instance in the organization, `setup(isPrivate: false, contextName)` |
| signature library | an app instance named `mero-sign:library` the account owns in no organization, `setup(isPrivate: true, contextName: "default")` |
| invitation | org invite token |

So a phone and a browser on the same account see the same agreements and share one library.

- **Sign-in**: a Calimero Cloud cluster by name (its nodes from the node directory, with failover)
  or a node URL, then the passkey (iOS: "Choose your cluster"; Android: the sign-in screen). A
  **development node** (`merod local`, mock attestation) gets a software passkey kept on the phone.
  iOS: `MeroNodeURL` / `MeroAllowMock` in `project.yml`; Android: `meroCluster` / `meroDevNodeUrl` in
  `android/gradle.properties` (debug builds allow cleartext to localhost and 10.0.2.2 only).
- **The contract** is the component ABI (`../logic/res/abi.json`): camelCase methods, arguments and
  answer fields, u64s as decimal strings in arguments, accounts as strings, blob ids as 64 hex,
  timestamps in milliseconds, refusals as `APP_ERROR {code, fields}` (`NotFound`, `Forbidden`,
  `Invalid`, `Conflict`). `SignClient` (Swift and Kotlin) is generated from it; `ContractSurfaceTests` /
  `ContractSurfaceTest` pin its names, parameters and number encoding to the ABI.
- **Blobs** go through the signed-in client: `uploadBlob(app, bytes, contentType)` (`application/pdf`
  for a signed version, `image/png` for a signature) and `blobContent(app, id)`; the contract stores
  the hex id.
- **Invitations**: the SDK's `OrgInvitation` links
  (`links.calimero.network/com.calimero.mero-sign/join?invitation=…`, plus Mero Sign's
  `workspaceName`), the web app's own `?invite=inv_…&agreement=<app id>` links (pasted), and a bare
  `inv_…` token. Redeeming answers the workspace.
- **Approvals**: when a node release or an app upgrade waits for the account (or a workspace it
  owns), the Inbox shows it under "Needs your approval". "Review" shows the confirmation code first,
  then opens the **node's consent page** (system browser / Custom Tab), which returns to
  `mero-sign://consent`. The app never approves by itself.
- On Android the Activity's passkey is handed to the session while it is on screen
  (`MeroAppSession.passkey`), for passkey step-ups.
- A real cluster's passkeys need the `webcredentials:<rp-id>` Associated Domain (iOS) or Digital
  Asset Links (Android) of that cluster; neither is set yet.

## Screens

1. **Sign in** — a passkey on your cluster, or a development node; says so when an invitation is waiting.
2. **Inbox** (tab) — every document in every agreement you are in, in **To sign / Waiting /
   Completed**, with "New agreements" you can see but have not opened yet. Pull to refresh.
3. **Agreements** (tab) — your workspaces and their agreements; opening one you have not entered
   joins it. **Agreement** — its documents and its people (name, level, you).
4. **Signatures** (tab) — your signature library: draw a new one, delete.
5. **Document** — status and progress, your part, who signs it and who has, the current
   version's file (integrity-checked against the recorded SHA-256), share, ids behind "Details".
6. **Viewer** — the PDF (PDFKit / `PdfRenderer`), share.
7. **Signing** — consent (the web's disclosure, word for word) → choose a saved signature or
   draw one on the pad (smooth strokes whose width follows the pen speed, undo, clear) → place it on any page (drag,
   resize) → finish. Optionally keeps a new drawing in your library.
8. **Invitation** — opens the web app's links (`links.calimero.network/com.calimero.mero-sign/join?invitation=…`
   or `calimero://`), or a pasted link.

## What signing does (same as the web, in order)

1. `whoami` for your **account**, then `hasConsented(account, document)`.
2. If not yet: `setConsent(document)` (no user argument; the contract records the caller).
3. The signature PNG is drawn onto the chosen page of the version you opened.
4. The signed PDF is uploaded as a blob (`application/pdf`) of the **agreement's instance**, hashed
   (SHA-256, lowercase hex), and `signDocument(documentId, baseHash, pdfBlobIdStr, fileSize,
   newHash)` is called with `baseHash` = the version you opened (a stale one is refused with
   `Conflict`; the app reloads and asks you to sign the new version).
5. `markParticipantSigned(documentId)`.

**Signature images** are stored as the web stores them: a PNG of the whole pad, opaque white with
black ink, uploaded (`image/png`) into the **library** and recorded with `createSignature("Signature
N", blob hex, byte size)`.

## Entering an agreement

As the web's `enterAgreement`: every member of the workspace reaches its agreements, so there is
nothing to join. Opening one you are not on the roster of registers you as a signer
(`registerSelfAsParticipant`; `Conflict` and `Forbidden` (a guest) are fine, you can still read),
settles on the contract's name, and records it in your library with `joinSharedContext(appId,
account, name)`, which writes the `IdentityMapping`. On 1.0 the identity in every agreement is the
account itself. An agreement counts as opened ("joined") once you are on its roster.

## Left out (and why)

- **Uploading documents, placing fields, semantic search / AI chat** — web-only by scope.
- **Creating workspaces and agreements, inviting, changing roles, removing people, deleting
  documents** — admin work, done on the web. The apps show roles read-only.
- **Live updates** — pull to refresh, and agreements that are still syncing are re-read every 10 s.
- **Setting your display name** — names shown are the ones set on the web (org member metadata).
- **Workspaces with no agreement yet** — the phones list organizations of this app (founded for it or running an instance), so a workspace created on the web shows once it has an agreement.

## How the signature goes into the PDF

All three draw it the same way as the web's `pdf-lib` `page.drawImage`: an image XObject added to
the page's resources and painted by a new content stream (`q w 0 0 h x y cm /Name Do Q`), with the
page's existing content wrapped in `q … Q`. Form fields, links, annotations and fonts are kept.

- **Web (pdf-lib)** and **Android (PdfBox-Android)** write the whole file back out.
- **iOS** writes an **incremental update**: the original bytes stay as they were, and the changed
  page plus the new objects are added after them (`SignCore/PDFIncremental.swift`). It reads
  classic xref tables, xref streams and object streams. Tested against a pdf-lib-written file and
  read back with pdf-lib and pdf.js.
- **iOS fallback**, only for files that writer refuses (encrypted, or a non-Flate filter in an
  xref or object stream): the signature becomes a printable, locked `/Stamp` annotation whose
  appearance draws the PNG, saved with PDFKit. Fields, values, links and annotations survive. But
  PDFKit saves through Quartz: content streams are re-encoded, fonts are re-embedded as subsets,
  and the form's `/Fields` entries are written as copies of the page widgets. Viewers that hide
  annotations hide that stamp.
- The placed box is mapped through the page's crop box and `/Rotate`, so the signature lands
  upright where it was placed on rotated pages too. The web's call doesn't account for `/Rotate`.

## Build and test (no simulator or emulator needed)

```bash
# iOS logic: the client against the ABI, the library, identity mapping, stamping, ink, view models
swift test --package-path ios/SignCore
# iOS app
cd ios && xcodegen generate && xcodebuild build -scheme MeroSign -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO

# Android
cd android && ./scripts/fetch-sdk.sh
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

## The contract client

`SignClient` (Swift `ios/SignCore/Sources/SignCore/Generated/SignClient.swift`, Kotlin
`android/.../generated/client/SignClient.kt`) is generated from `../logic/res/abi.json` by core's
`mero-app-build codegen`. After a contract change run `scripts/mobile-codegen.sh` at the repo root,
commit, and update the method table in the contract-surface tests; CI's `Mobile clients` workflow
fails on a stale client. Until the logic derives `AbiType`, the ABI names the answer types without
their shape, so the client takes and answers their JSON and the kept types read it
(`SignCore/Records.swift`, `generated/SignRecords.kt`).

## Callbacks

The node's consent page returns to `mero-sign://consent` (iOS `MeroSignCallbackScheme` in
`ios/project.yml`; Android `meroConsentCallback` in `android/gradle.properties`, also the manifest's
intent filter).

## CI

`.github/workflows/mero-sign-ios.yml` (`swift test` + an unsigned iOS Simulator build) and
`.github/workflows/mero-sign-android.yml` (ktlint, detekt, unit tests, lint, `assembleDebug`),
each path-filtered to its folder.
