# Mero Vote: native mobile apps

Native iOS and Android clients for Mero Vote, next to the web frontend (`../app`) and the contract
(`../logic`, package `com.calimero.mero-vote`). Both apps have the same screens, copy, icons (SF
Symbols on iOS, Material Icons on Android) and flows, and both build ballots byte for byte as the
web client does.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, XcodeGen | swift-sdk `v0.5.0` |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | kotlin-sdk `0.4.0`, composite build |

Both pins are SDK releases. To bump them, change `exactVersion:` in `ios/project.yml` and `exact:` in
`ios/VoteCore/Package.swift` to the new release (and refresh `ios/VoteCore/Package.resolved`), and set
`android/kotlin-sdk.ref` to the new kotlin-sdk tag's commit.

## How the apps reach Calimero

**Both apps run on Calimero 1.0.** They talk to a node of a Calimero Cloud cluster over the sealed
channel (`calimero/sealed-http/v2`, after the node's TDX attestation is verified) and sign in with a
passkey; they run no node. The session builds the SDK's `CalimeroAppBackend`, and the view models
keep their `MeroAppBackend` calls, each of which maps one to one:

| The app | `MeroAppBackend` | Calimero 1.0 |
| --- | --- | --- |
| workspace | namespace | organization (metadata `package = com.calimero.mero-vote`) |
| voting group | context | org-wide app instance (`/apps/{app}/views`, `/intents`, `/events`) |
| invitation | `OrgInvitation` | org invite token, redeemed at `/invites/{token}/redeem` |

Sign-in (`ios/Sources/App/CloudAccess.swift`, `android/.../ui/CloudAccess.kt`, the same screens):

- **Calimero Cloud:** your cluster by name (`eu-shared-1`, its nodes read from the Calimero Cloud
  directory) or by a node's URL (`MeroNodeURL` on iOS, `-PmeroNodeUrl` on Android prefills it),
  then *Sign in with passkey* or *Create an account*. The device's passkey belongs to the
  cluster's relying party: a real cluster needs the `webcredentials:<rp-id>` associated domain on
  iOS and the RP's Digital Asset Links on Android.
- **Development node:** a `merod local` node (`http://localhost:2501` on iOS,
  `http://10.0.2.2:2501` from the Android emulator), mock attestation allowed, with a software
  passkey kept on the device for it.
- **Approvals** (Account sheet): node releases and app upgrades waiting for you, per workspace and
  for your own apps. *Review* shows the node's confirmation code first, then opens the node's
  consent page in the system browser (a Custom Tab on Android), which returns to
  `mero-vote://consent`. The app's own session cannot approve anything.
- Member changes and invites are passkey step-ups: iOS hands the session's passkey to the backend;
  Android sets `MeroAppSession.passkey` from the Activity on screen.

A voting group sits directly in its workspace, so one workspace invitation covers both. Live
updates come from `MeroAppBackend.events(contextId)`, with a 10-second poll when the stream is not
available.

## The contract surface

Both clients call the contract's component ABI, exactly as the web app's adapter
(`../app/src/meroVote.ts`) does:

- methods and arguments are camelCase (`castBallot`, `getPoll`, `pollId`, `minChoices`,
  `closesAt`); answers keep their snake_case fields;
- every u64 in an answer (`created_at`, `cast_at`, `closed_at`…) is a decimal string, read back
  into a number (`VoteWireDecoding`); `closesAt` goes out as a decimal string or `null`;
- a refusal is `422 APP_ERROR {code, fields: {message}}` with the ABI's codes (`Forbidden`,
  `Phase`, `Invalid`, `Crypto`, `NotFound`); `VoteErrorText` puts them, and the node's own
  errors (cancelled passkey, ended session, wrong node, unavailable cluster, release deadline,
  stale consent), in plain words;
- a sealed poll's `closure.aggregate` (new) is decoded; a ballot must verify in one call, so the
  new-poll sheet refuses `2·options + maxChoices − minChoices + 1 > 38` before sending.

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
  `TranscriptAudit`, over `getTranscript` and compares counts and transcript digest with the node.

## Screens

1. **Sign in**: what Mero Vote is (encrypted here, shared key, audited by everyone); a Calimero
   Cloud passkey (sign in or create an account) or a development node. An invitation that arrived
   while signed out is named here.
2. **Voting groups**: each workspace with its voting groups (newest poll's question, poll count,
   how many are open); New workspace (founds the org and its first group), New group in a
   workspace, Join with a link, Account (Approvals, ids behind Details, Sign out). Pull to refresh.
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
trustee key backup and restore (same file format), invitation links. The apps mint the SDK's link
(`https://links.calimero.network/com.calimero.mero-vote/join?invitation=…` and `calimero://…`,
payload `{invitation: "inv_…", namespaceId, contextId}`) and also read the web app's
(`…?invite=inv_…`, or a bare `inv_…` token), which names no group: after joining, the org's first
voting group opens. A pre-1.0 signed invitation is refused.

Left out, and why:

- **Namespace-wide member names** (`@calimero-apps/names`, `publishMemberName`): `MeroAppBackend`
  is not used; names come from the contract's roster (`setName`), which is what
  trustee and voter pickers use anyway.
- **Context and namespace ids as the primary label, the session menu, the theme switch**: there
  is no node on the phone, and the apps are light only. Ids are behind Details.
- **Leaving or deleting a workspace or group**: `MeroAppBackend` has no leave or delete call.
- **Names for voting groups**: `listContexts` returns ids only, so a group is shown by its newest
  poll's question and its poll counts.

## Contract client

`ios/VoteCore/Sources/VoteCore/VoteClient.swift` and
`android/app/src/main/kotlin/network/calimero/vote/generated/VoteClient.kt` are kept by hand
against the component ABI (`../logic/res/abi.json`), in step with `../app/src/meroVote.ts`; each
takes the SDK's `ContextContractCalling` (`contract.bound(to: contextId)`). `WireTests` /
`WireTest` pin the method names, `pollId`, `closesAt` and the u64 decoding. The v1 abi-codegen
does not read the component ABI, so `scripts/regenerate-client.sh` refuses to run.

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

- **iOS**: `MeroNodeURL` (your Cloud cluster by name or a node's URL; empty: the sign-in screen
  asks) and `MeroDevNodeURL` (the development node it offers) in `project.yml`; the node's consent
  page returns to `mero-vote://consent` (`MeroVoteCallbackScheme`).
- **Android**: `-PmeroNodeUrl=…` (the same), `-PmeroDevNodeUrl=…` (default
  `http://10.0.2.2:2501`; debug builds allow cleartext to localhost and 10.0.2.2 only) and
  `meroConsentCallback` (default `mero-vote://consent`, also the manifest's intent filter) in
  `gradle.properties`.
- **Font**: Power Grotesk, converted from the web's WOFF2 files.

## CI

`.github/workflows/mero-vote-ios.yml` (regenerate the vectors from the web client and require no
diff; macOS `swift test` on VoteCore; XcodeGen and an unsigned simulator build) and
`.github/workflows/mero-vote-android.yml` (fetch the SDK, ktlint, detekt, unit tests incl. the
vectors, Android lint, `assembleDebug`), each path-filtered to its folder and the shared vectors.
