# Mero Stream: native mobile apps

Native iOS and Android clients for Mero Stream, next to the web frontend (`../app`) and the
contract (`../logic`, package `com.calimero.mero-stream`). Both platforms have the same screens,
copy, icons and flows.

> Mero Stream is a **capacity probe**: it carries live video on the Calimero context's
> ephemeral presence to measure how far that goes (see `../README.md`). Real low-latency calls
> belong on WebRTC ("Mero Meet"). These apps do what the web app does today, on a phone, so a
> phone and a browser can be in the same room. They do not build a WebRTC stack.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, AVFoundation + VideoToolbox | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `v0.5.0` |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26, CameraX + MediaCodec | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0.4.0` (`android/kotlin-sdk.ref`) |

**SDK pins.** Both pin their SDK's Calimero 1.0 release (iOS in
`ios/Core/Package.swift` and `ios/project.yml`, Android in `android/kotlin-sdk.ref`, set to the
release tag's commit).

## Calimero 1.0

Both apps talk to a Calimero 1.0 cluster the same way, through the SDK's `MeroAppSession`: every
request goes over the sealed channel to an attested node.

- **Sign in.** "Choose your cluster" offers **Calimero Cloud** (the cluster's name, whose nodes the
  node directory lists, or one node's URL; real TDX attestation) or a **Development node**
  (`merod local`, mock attestation; `http://127.0.0.1:2501` from the iOS Simulator,
  `http://10.0.2.2:2501` from the Android emulator). Then "Sign in with a passkey" or "Create an
  account". On a development node the app keeps a soft passkey for that node and creates its
  account on the first sign-in. The session is kept in the Keychain / encrypted preferences and
  refreshed at launch. Build-time defaults: `MeroCluster` / `MeroNodeURL` / `MeroAllowMock` in
  `ios/project.yml`, `-PmeroCluster` / `-PmeroNodeUrl` / `-PmeroAllowMock` for Android.
- **Words**: a stream is an **organization**; a room is an **app instance** in it (its call),
  created with `init({ name })`. Everyone in the organization reaches every room, so entering a
  room needs no join step; the contract's own `join` records your name in the call. This is the
  web app's model.
- **The contract** is the component ABI (`../logic/res/abi.json`): the phones call `join(username,
  now)` and `getMembers()`, camelCase, with u64 values (`now`, `joinedAt`, `updatedAt`) as decimal
  strings. `StreamClient` (Swift and Kotlin) is a small hand-written client for those two; a unit
  test pins its method list. The contract's typed refusals (`APP_ERROR {code, fields}`:
  `NotJoined`, `ChunkTooLarge{max}`, …) and the node's errors (`ConfirmCancelled`,
  `LoginRequired`, `WrongNode`, `Unavailable`, `ReleaseDeadline`, `ConsentStale`) read as plain
  words (`ErrorText`).
- **Names**: your name in a call is the contract's `username`. Renaming also sets it for the
  whole stream (the organization's member metadata, as the web does), and a tile with no room
  name shows the stream-wide one.
- **Media** rides the room's **presence** on the cluster (`CalimeroMediaChannel`:
  `POST /apps/{app}/presence`, read back off `/apps/{app}/presence/stream`). 1.0 presence state is
  at most **4 KiB**, so `LiveFrames` slices are 4096 bytes (a frame is more fragments; the framing
  is unchanged and still matches the web's vectors at 16 KiB). The presence `seq` is seeded from
  the clock, so it keeps growing across launches. An entry lapses after 7 s without a refresh; a
  live call publishes far more often than that.
- **Invitations** are org invite links. Minting one asks for your passkey (the node's step-up).
  The link's payload is the SDK's `OrgInvitation`, `{invitation: "inv_…", namespaceId,
  contextId?, name?}`, plus `kind`, `roomId` and `namespaceName`:
  `https://links.calimero.network/com.calimero.mero-stream/join?invitation=<base58(deflate(json))>`.
  Joining redeems the token. A stream link lands on its rooms; a room link drops you into that
  call. The web app's own link (`<frontend>/?invite=inv_…&stream=<org>&room=<app>&name=…`) pasted
  into "Join with a link" opens too.
- **Approvals**: a node release or app upgrade that waits for the account (or a stream it owns)
  shows under "Needs your approval" on Streams. "Review" asks the node for a consent request, shows
  its **confirmation code** first, and then opens the **node's consent page in the system
  browser** (Custom Tab on Android), which shows the same code and returns to
  `mero-stream://consent`.
- A real cluster's passkeys need the `webcredentials:<rp-id>` Associated Domain (iOS) / Digital
  Asset Links (Android) of that cluster; neither is set yet.

## The media path, and how it matches the web

The web app's live route (`/live`, `hooks/useLiveStream.ts`) encodes 640×480 H.264 with WebCodecs
and publishes each access unit on presence, framed by `lib/ephemeralFrames.ts`. The apps do the
same, byte for byte:

| | Web | Phone |
| --- | --- | --- |
| Framing | header v2 (`"MS"`, track, flags, msgSeq, frag index/count, w/h, timestamps, `startedAtMs`, codec) in ≤4 KiB slices | `LiveFrames` (Swift and Kotlin), checked against vectors the web's own `encodeFragments` produced (`scripts/gen-frame-vectors.ts` → `frame-vectors.json` in both test suites; CI regenerates and diffs them) |
| Video codec | H.264 Baseline, WebCodecs `avc: { format: "annexb" }`, SPS/PPS inline on keyframes | H.264 Baseline 3.1: VideoToolbox (AVCC rewritten to Annex-B with SPS/PPS put in front of every keyframe) / MediaCodec (its codec-config buffer put in front of every keyframe). A browser decodes a phone with no out-of-band description |
| Codec string | `avc1.42001f` | read from the encoder's own SPS (`avc1.PPCCLL`, e.g. `avc1.42c01f`), so the browser's decoder is configured with what was actually encoded |
| Picture | 640×480 landscape | 480×640 portrait (a phone is held upright); the real size is in the header and the browser's canvas follows the decoded frame |
| Keyframes | every 2 s, plus on demand | every 2 s, plus after a dropped frame |
| Rate | 25 fps / 1.5 Mbps, split among broadcasters (`lib/capacity.ts`) | 15 fps / 1 Mbps, split the same way: every slice is a presence POST to the node |
| Receive | per-sender reassembly, keyframe gate, replays (`ageMs`) and own echo dropped | the same (`FrameReassembler`, `CallModel`), decoded by `AVSampleBufferDisplayLayer` / MediaCodec onto a `TextureView` |
| Broadcast slots | at most 2 on camera, first come first served, the late one yields (`lib/slots.ts`) | the same (`Slots`), from the same headers, so phones and browsers agree |

**Audio.** The web app sends no audio and drops anything on track 1 ("audio would ride track 1").
The phones send the microphone on **track 1 as G.711 µ-law** (`ulaw`, 8 kHz mono, 200 ms packets,
own `msgSeq` counter, bit-exact with the CCITT reference) and play it per speaker. So phones hear
each other; a browser neither sends nor plays audio, and the mute control only affects phones.
µ-law was chosen because it needs no platform codec on either side and is the WebCodecs registry's
`ulaw`, which a browser could decode later.

## Screens

1. **Sign in**: what the app is; choose the cluster (Calimero Cloud or a development node), then
   "Sign in with a passkey" / "Create an account".
2. **Streams**: your streams with room and member counts, and what needs your approval; create one (sheet), join with a link
   (sheet), invite to a stream (swipe or long press, system share sheet), pull to refresh. An
   opened invitation link asks "Join this stream?" / "Join this call?" first.
3. **Rooms** (one stream): its rooms with who is in each, "Join"; create a room (sheet), invite to
   the stream or to one room, pull to refresh, the stream id behind Details.
4. **Call**, laid out like Google Meet on a phone: a dark stage with a tile per person (camera,
   or initials; a lime ring and a waveform while someone talks; "Waiting for a keyframe…" while a
   new sender's first keyframe is on its way), the room, call timer and "n/2 on camera" on top,
   switch camera while yours is on, and a bottom bar: mic, camera, people (with a count), call
   details, leave. Notices for joining, a full or yielded camera slot, a choppy two-broadcaster
   call (with "Why?"), and errors.
   - **People** sheet: your nickname (asked once when you have none), and everyone in the room,
     on camera or watching.
   - **Call details** sheet: on camera, your encoding, codec, frames sent/dropped/received, publish
     time and errors, latency, audio packets, why it can be choppy, and the ids behind Details.

Camera and microphone are asked for the first time you turn them on (`NSCameraUsageDescription`,
`NSMicrophoneUsageDescription`; `CAMERA`, `RECORD_AUDIO` at runtime); a refusal explains itself
and offers Settings.

## Not on mobile

- **The probe instruments.** The web's `/stream` (approach 3, in-WASM toy codec), the `post_chunk`
  path (approach 2), the fps and bitrate sliders, the CSV export and the full §4 metric set are
  measurement tools for the probe, not part of a call. The Details sheet shows the numbers that
  matter on a phone.
- **Audio to and from browsers**: the web app has no audio (see above).
- **Renaming a stream or room, leaving, deleting**: the web has no UI for them either.
- **Chat**: the web app has none.
- **Dark list screens**: the lists use the Calimero light style; the call is dark like the web's stage.

## The frame vectors

After a change to the web's framing (`app/src/lib/ephemeralFrames.ts`), regenerate the test
vectors with `node scripts/gen-frame-vectors.ts` (Node 22.6+) and make the native ports pass.

## Build and test

```bash
# iOS: everything but the views and the camera is a Swift package, tested on macOS
cd ios/Core && swift test
cd ios && xcodegen generate && open MeroStream.xcodeproj

# Android
cd android && ./scripts/fetch-sdk.sh
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

Both run without a node: the view models are tested on the SDKs' in-memory backends
(`InMemoryAppBackend`), which also drive previews and screenshots.

## CI

`.github/workflows/mero-stream-ios.yml` (the frame vectors against the web encoder; `swift test`
on the core package; XcodeGen and a build of the app) and
`.github/workflows/mero-stream-android.yml` (fetch the SDK, ktlint, detekt, unit tests, Android
lint, `assembleDebug`), each path-filtered to its folder.
