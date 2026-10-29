# Mero Sign — native mobile apps

Native iOS and Android clients for Mero Sign, next to the web frontend (`../app`) and the
contract (`../logic`, package `com.calimero.mero-sign`). Both apps have the same screens, copy,
flows and (mapped) icons. Their job is the recipient's: **review and sign the agreements you were
sent.** Uploading documents, placing fields and the semantic search stay on the web.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, PDFKit | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `c9ca1a0` (in `ios/project.yml` and `ios/SignCore/Package.swift`) |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26, `PdfRenderer` + PdfBox-Android | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `ea8ded7` (`android/kotlin-sdk.ref`, composite build) |

The pins are the `main` merge commits of swift-sdk#84 and kotlin-sdk#67.

## Delegated execution only

Neither app runs or logs into a node. The person signs in with their Calimero account (the wallet
certifies the device key) and everything goes through the account's relay with the SDKs'
`MeroAppSession` / `MeroAppBackend`: contract reads are relay queries, writes are signed warrants,
blobs are read and written through the agreement's context.

## Screens

1. **Sign in** — Cloud sign-in; says so when an invitation is waiting.
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

1. `whoami` for your **account**, then `has_consented(account, document)`.
2. If not yet: `set_consent(document)` (no user argument; the contract records the caller).
3. The signature PNG is drawn onto the chosen page of the version you opened.
4. The signed PDF is uploaded as a blob **into the agreement's context**, hashed (SHA-256, lowercase
   hex), and `sign_document(document_id, base_hash, pdf_blob_id_str, file_size, new_hash)` is
   called with `base_hash` = the version you opened (a stale one is refused; the app reloads and
   asks you to sign the new version).
5. `mark_participant_signed(document_id)`.

**Signature images** are stored exactly as the web stores them: a PNG of the whole pad, opaque
white with black ink (`signature_pad`, `minWidth 2`, `maxWidth 4`), at the device's pixel ratio,
uploaded into the **private** context and recorded with `create_signature("Signature N", blob hex,
byte size)`.

## Identity mapping and the private context

Exactly what the web does when a recipient opens an invitation (`joinWorkspaceFromInvitation` →
`settleIntoAgreement`):

1. Join the workspace (namespace) the signed invitation names.
2. Find the agreement (the one the link hints at if it is in the workspace, else the only one).
3. Enter it (join its open subgroup), wait while it answers "Uninitialized".
4. `register_self_as_participant` ("Already registered" is fine).
5. Settle the name (the contract's `context_name` wins).
6. Ensure the **private context** and record the agreement there with
   `join_shared_context(context_id, shared_identity, name)`, which writes the `IdentityMapping`.
   Through a relay the identity held in every context is the account itself, so the shared
   identity is the account — as the web records it for an account session.

The private context is found and created like the web's `DefaultContextService` /
`ensurePersonalWorkspace` / `createPersonalContext`: a namespace marked by its metadata record
(`data.kind = "mero-sign:personal"`, never by name), a **restricted** "Private" subgroup, a context
initialised `{is_private: true, context_name: "default"}`, confirmed with
`is_default_private_context`. A phone and a browser on the same account share one library.

Opening an agreement from the Agreements tab that you entered but never registered in runs the same
settle step once. `get_shared_identity` / `resolve_private_identity` are not called on open or
sign, by the web or here: the contract derives the signer from the caller's account.

## Left out (and why)

- **Uploading documents, placing fields, semantic search / AI chat** — web-only by scope.
- **Creating workspaces and agreements, inviting, changing roles, removing people, deleting
  documents** — admin work, done on the web. The apps show roles read-only.
- **Live updates** — pull to refresh, and agreements that are still syncing are re-read every 10 s.
- **Setting your display name** — names shown are the ones set on the web (namespace member names).

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
# iOS logic: generated client, private store, identity mapping, stamping, ink, view models
swift test --package-path ios/SignCore
# iOS app
cd ios && xcodegen generate && open MeroSign.xcodeproj

# Android
cd android && ./scripts/fetch-sdk.sh
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

## Regenerate the contract client

Both clients are generated from `../logic/res/abi.json` with `abi-codegen`, using the SDKs' own
`ContextContractCalling` (`--transport-import`). Fixed-size ids (`[u8; 32]`) arrive as
`ContractBytes` (text or a byte array) and are turned into lowercase hex at the call sites.

```bash
ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate-client.sh
```

## Sign-in callback

Both apps default to `mero-sign://enrol` (`MeroSignCallbackScheme` in `ios/project.yml`,
`meroEnrolCallback` in `android/gradle.properties`). The hosted wallet may only return to `https://`
callbacks; production sign-in then needs a verified https callback (Associated Domains / App Links).

## CI

`.github/workflows/mero-sign-ios.yml` (`swift test` + an unsigned iOS Simulator build) and
`.github/workflows/mero-sign-android.yml` (ktlint, detekt, unit tests, lint, `assembleDebug`),
each path-filtered to its folder.
