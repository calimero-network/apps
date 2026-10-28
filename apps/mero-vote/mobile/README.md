# Mero Vote: native mobile apps

Native iOS and Android clients for Mero Vote, next to the web frontend (`../app`) and the contract
(`../logic`, package `com.calimero.mero-vote`). Both apps have the same screens, copy, icons (SF
Symbols on iOS, Material Icons on Android) and flows, and both build ballots byte for byte as the
web client does.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, XcodeGen | swift-sdk `122bb0d71bb43b823cb9d694c4e70678a2ef8c89` (`feat/app-session`, swift-sdk#84) |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | kotlin-sdk `0999426846c23c5821929c62547af3510c8b670b` (`feat/app-session`, kotlin-sdk#67), composite build |

The SDK pins are the open app-session PRs. Once those merge, move the pins to the merge commits:
`revision:` in `ios/project.yml` and `ios/VoteCore/Package.swift` (keep the two identical), and
`android/kotlin-sdk.ref`.

## Delegated execution only

Neither app runs or logs into a node. Both are built on the SDKs' `MeroAppSession`: the person
signs in with their Calimero account (the wallet certifies this device's key), the Cloud manager
names the account's relay, and everything goes through that relay. Views are the relay's
account-scoped query, writes are warrants the device key signs. A workspace is a namespace founded
through the relay; a voting group is a context directly in it (as on the web, so one namespace
invitation covers both). Live updates come from `MeroAppBackend.events(contextId)`, with a
10-second poll when the relay cannot stream.

## The cryptography on the phone

A ballot is built on the device: one exponential-ElGamal ciphertext per option on ristretto255,
CDS94 proofs that each is 0 or 1 and that the number chosen is within the poll's bounds, all bound
by Fiat–Shamir (SHA-512) to the poll, the voter and the election key. Trustees run the Pedersen
key ceremony (transport key with a Schnorr proof, Feldman-committed dealing, complaints with
Chaum–Pedersen proofs) and publish proven partial decryptions. See `../README.md` for the design.

- **Ported, not wrapped.** Neither CryptoKit/swift-crypto nor the JDK/Android/BouncyCastle expose
  ristretto255 or raw group arithmetic, so the group is implemented from its specifications on both
  platforms, line for line the same: the field GF(2^255-19), point addition and scalar reduction
  mod ℓ are TweetNaCl's; encode, decode, equality and SQRT_RATIO_M1 follow RFC 9496 §4. Scalar
  multiplication is a fixed 4-bit window with constant-time table reads (a precomputed comb for the
  generator). SHA-256/512 and randomness are the platforms' own (CryptoKit + `SecRandomCopyBytes`;
  `MessageDigest` + `SecureRandom`). Files: `ios/VoteCore/Sources/VoteCrypto/{Curve,VoteProtocol}.swift`,
  `android/app/src/main/kotlin/network/calimero/vote/crypto/{Curve,VoteProtocol}.kt`, each a
  port of the web's `app/src/crypto/protocol.ts`.
- **Pinned to the web client by shared vectors.** `test-vectors/generate.mjs` imports the web app's
  own `app/src/crypto/protocol.ts` and `verify.ts` (no re-implementation) and runs a whole poll from
  fixed seeds: generator multiples, point/scalar decoding accept/refuse cases, scalar arithmetic,
  hashes, the seeded rng, Lagrange coefficients, transport keys, dealings, shares, a complaint
  against a cheating dealer, approval and single-choice ballots with their digests, the aggregate,
  partial decryptions and counts, and seven transcripts with the web's re-audit verdict on each
  (honest, a tampered ballot, a bad partial, a node that disagrees, anchored, a wrong anchor, still
  voting). `VectorTests` (Swift) and `VectorTest` / `TranscriptAuditTest` (Kotlin) replay every one
  and must match byte for byte. CI regenerates the file and fails if it changed.

  ```sh
  pnpm install --filter mero-vote                     # @noble/curves, @noble/hashes
  node apps/mero-vote/mobile/test-vectors/generate.mjs
  ```
- **Secrets stay on the device.** The plaintext choice is forgotten once the ballot is sent. A
  trustee's transport secret is the one value kept: in the iOS Keychain (this device only) or, on
  Android, encrypted with an AndroidKeyStore AES-GCM key. Its backup is the web's JSON format
  (`mero-vote-trustee-<poll>.json`), so a key saved on the web restores on the phone and back.
  The dealing polynomial lives only inside the call that deals, and the combined key is re-derived
  from the frozen dealings when a partial is published.
- **Re-verify on this device** runs the web's independent re-audit (`verify.ts`), ported as
  `TranscriptAudit`, over `get_transcript` and compares counts and transcript digest with the node.

## Screens

1. **Sign in**: what Mero Vote is (encrypted here, shared key, audited by everyone) and "Sign in
   with Calimero". An invitation that arrived while signed out is named here.
2. **Voting groups**: each workspace with its voting groups (newest poll's question, poll count,
   how many are open); New workspace (founds the namespace and its first group), New group in a
   workspace, Join with a link, Account (ids behind Details, Sign out). Pull to refresh.
3. **Polls** (a voting group): a "Pick a name" prompt until you are on the roster; open / in key
   ceremony / closed counts; poll cards with phase, creator, ballots and a four-step progress strip;
   a lime New poll button; Members (your name, everyone on the roster) and Invite (share or copy).
4. **Poll**: phase, question, rules, eligibility, planned close and the steps strip; your ballot
   (radio or checkboxes, "Encrypt & cast ballot", your receipt); the trustees card (status per
   trustee, Step 1 publish a transport key, Step 2 deal key shares, shares dealt to you with File
   complaint, publish your decryption share, save / restore the key backup); the creator's Open
   voting, Close poll and Seal the count (confirmed); turnout; the result with bars and the winner;
   the audit (checks behind a disclosure, Re-verify on this device, Share transcript); the public
   anchor; ids, election key, transcript digest and receipt behind Details.
5. **Sheets**: new poll (question, details, 2–16 options, exactly one or up to N, trustees and
   threshold with the web's warnings, who can vote, planned close), new workspace, your name, join
   with a link, invitation prompt (join, joining, joined, failed), invite link, restore key (paste
   or choose the file), record anchor.

## Features vs the web app

Same as the web: workspaces and voting groups (create; join by invitation), the roster and your
name, creating polls with every option the web has, the whole key ceremony including complaints,
casting and replacing a ballot, close and seal, partial decryption, the result, the node's audit,
the independent re-verification, the transcript download (shared as a file), the public anchor,
trustee key backup and restore (same file format), invitation links in the web's format both ways
(`https://links.calimero.network/com.calimero.mero-vote/join?invitation=…` and `calimero://…`).

Left out, and why:

- **Namespace-wide member names** (`@calimero-apps/names`, `publishMemberName`): `MeroAppBackend`
  has no group-metadata calls; names come from the contract's roster (`set_name`), which is what
  trustee and voter pickers use anyway.
- **Context and namespace ids as the primary label, the session menu, the theme switch**: there
  is no node on the phone, and the apps are light only. Ids are behind Details.
- **Leaving or deleting a workspace or group**: `MeroAppBackend` has no leave or delete call.
- **Names for voting groups**: `listContexts` returns ids only, so a group is shown by its newest
  poll's question and its poll counts.

## Generated contract client

The contract calls are generated, never hand-written: `ios/VoteCore/Sources/VoteCore/VoteClient.swift`
and `android/app/src/main/kotlin/network/calimero/vote/generated/VoteClient.kt`, from
`../logic/res/abi.json` with mero-devtools-js's abi-codegen and `--transport-import`, so each takes
the SDK's `ContextContractCalling` and `VoteClient(transport: contract.bound(to: contextId))` needs
no adapter. Regenerate both after a contract change:

```sh
ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate-client.sh
```

## Build and test

iOS:

```sh
cd ios
swift test --package-path VoteCore       # crypto vectors, transcript audit, view models, on macOS
xcodegen generate && open MeroVote.xcodeproj
```

The logic is the local `VoteCore` SwiftPM package (targets `VoteCrypto`, dependency-free, and
`VoteCore`), so it builds and tests on macOS with no simulator; the SwiftUI app target links it.
`VoteCrypto` is always compiled with `-O`: field arithmetic at `-Onone` is an order of magnitude
slower.

Android:

```sh
cd android
./scripts/fetch-sdk.sh                   # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

The view-model tests on both platforms run against the SDKs' fakes (`InMemoryAppBackend`,
`RecordingContextContract`) and the shared vectors.

## Configuration

- **Sign-in callback**: `mero-vote://enrol` (iOS `MeroVoteCallbackScheme` in `project.yml`,
  Android `meroEnrolCallback` in `gradle.properties`). The hosted wallet currently returns only to
  `https://` callbacks, so production sign-in needs that wallet change or a verified https
  callback, as for the other native apps.
- **Environment**: empty values use the SDK defaults (hosted Cloud manager, wallet, registry).
  iOS: `MeroCloudBaseURL`, `MeroWalletURL`, `MeroRegistryURL` in `project.yml`. Android:
  `-PmeroCloudUrl=… -PmeroWalletUrl=… -PmeroRegistryUrl=…`.
- **Font**: Power Grotesk, converted from the web's WOFF2 files.

## CI

`.github/workflows/mero-vote-ios.yml` (regenerate the vectors from the web client and require no
diff; macOS `swift test` on VoteCore; XcodeGen and an unsigned simulator build) and
`.github/workflows/mero-vote-android.yml` (fetch the SDK, ktlint, detekt, unit tests incl. the
vectors, Android lint, `assembleDebug`), each path-filtered to its folder and the shared vectors.
