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
| iOS | `ios/` | SwiftUI, iOS 16+, AVFoundation + VideoToolbox | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `122bb0d` |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26, CameraX + MediaCodec | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0999426` (`android/kotlin-sdk.ref`) |

**SDK pins.** Both pin the SDKs' `feat/app-session` branches (swift-sdk PR #84, kotlin-sdk PR
#67), which add `MeroAppSession`, `MeroAppBackend` and `ContextContract`. The pins move to the
merge commits once those PRs land: `ios/Core/Package.swift` and `ios/project.yml` on iOS,
`android/kotlin-sdk.ref` on Android.

## Delegated execution only

Neither app runs or logs into a node. The person signs in with their Calimero account (the
wallet certifies the phone's device key), the Cloud manager names the relay that serves the
account, and everything goes through that relay with the SDKs' `MeroAppSession`:

- **Streams and rooms** are what the web app makes: a stream is a namespace founded for the app;
  a room is an open subgroup in it plus the context that is its call, created with
  `init({ name })`.
- **Contract calls** (`join`, `get_members`) go through the generated `StreamClient`: views as
  the relay's account-scoped query, writes as warrants the device key signs.
- **Media** rides the room context's ephemeral presence through the relay
  (`RelayPresenceClient`: device-signed `presence-intents` posts, read back off the relay's event
  stream). The web app publishes the same slices with its node's `set_ephemeral`.
- **Invitations** use the web app's format, so a link from either side opens on the other:
  `https://links.calimero.network/com.calimero.mero-stream/join?invitation=<base58(deflate(json))>`
  with `{invitation, kind: "namespace" | "room", groupId, groupAlias, roomId?, contextId?, roomName?}`.
  A stream link lands on its rooms; a room link drops you into that call.

## The media path, and how it matches the web

The web app's live route (`/live`, `hooks/useLiveStream.ts`) encodes 640×480 H.264 with WebCodecs
and publishes each access unit on presence, framed by `lib/ephemeralFrames.ts`. The apps do the
same, byte for byte:

| | Web | Phone |
| --- | --- | --- |
| Framing | header v2 (`"MS"`, track, flags, msgSeq, frag index/count, w/h, timestamps, `startedAtMs`, codec) in ≤16 KiB slices | `LiveFrames` (Swift and Kotlin), checked against vectors the web's own `encodeFragments` produced (`scripts/gen-frame-vectors.ts` → `frame-vectors.json` in both test suites; CI regenerates and diffs them) |
| Video codec | H.264 Baseline, WebCodecs `avc: { format: "annexb" }`, SPS/PPS inline on keyframes | H.264 Baseline 3.1: VideoToolbox (AVCC rewritten to Annex-B with SPS/PPS put in front of every keyframe) / MediaCodec (its codec-config buffer put in front of every keyframe). A browser decodes a phone with no out-of-band description |
| Codec string | `avc1.42001f` | read from the encoder's own SPS (`avc1.PPCCLL`, e.g. `avc1.42c01f`), so the browser's decoder is configured with what was actually encoded |
| Picture | 640×480 landscape | 480×640 portrait (a phone is held upright); the real size is in the header and the browser's canvas follows the decoded frame |
| Keyframes | every 2 s, plus on demand | every 2 s, plus after a dropped frame |
| Rate | 25 fps / 1.5 Mbps, split among broadcasters (`lib/capacity.ts`) | 15 fps / 1 Mbps, split the same way: every slice is a signed relay POST |
| Receive | per-sender reassembly, keyframe gate, replays (`ageMs`) and own echo dropped | the same (`FrameReassembler`, `CallModel`), decoded by `AVSampleBufferDisplayLayer` / MediaCodec onto a `TextureView` |
| Broadcast slots | at most 2 on camera, first come first served, the late one yields (`lib/slots.ts`) | the same (`Slots`), from the same headers, so phones and browsers agree |

**Audio.** The web app sends no audio and drops anything on track 1 ("audio would ride track 1").
The phones send the microphone on **track 1 as G.711 µ-law** (`ulaw`, 8 kHz mono, 200 ms packets,
own `msgSeq` counter, bit-exact with the CCITT reference) and play it per speaker. So phones hear
each other; a browser neither sends nor plays audio, and the mute control only affects phones.
µ-law was chosen because it needs no platform codec on either side and is the WebCodecs registry's
`ulaw`, which a browser could decode later.

## Screens

1. **Sign in**: what the app is, "Sign in with Calimero".
2. **Streams**: your streams with room and member counts; create one (sheet), join with a link
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
- **Namespace-wide member names** (`@calimero-apps/names`) and the TEE badge: `MeroAppBackend` has
  no member-name or group-member call. Names come from the room contract's `get_members`.
- **Renaming a stream or room, leaving, deleting**: no web UI for most of it, and no
  `MeroAppBackend` call for leave/delete.
- **Chat**: the web app has none.
- **Dark list screens**: the lists use the Calimero light style; the call is dark like the web's stage.

## Regenerating the contract client

`ios/Core/Sources/StreamCore/Generated/StreamClient.swift` and
`android/app/src/main/kotlin/network/calimero/stream/generated/StreamClient.kt` are generated from
`../logic/res/abi.json` with `calimero-abi-codegen --target swift|kotlin --transport-import`, so
they take the SDKs' own `ContextContractCalling` and `StreamClient(contract.bound(contextId))`
needs no adapter. Do not edit them; after a contract change run:

```bash
./scripts/regenerate-clients.sh
# or with a local build of the codegen:
ABI_CODEGEN="node /path/to/abi-codegen/dist/cli.js" ./scripts/regenerate-clients.sh
```

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

Sign-in callback: `mero-stream://enrol` (iOS `project.yml` `StreamCallback*`, Android
`meroEnrolCallback`). Empty `MeroCloudBaseURL` / `meroCloudUrl` etc. mean the SDK's defaults.

## CI

`.github/workflows/mero-stream-ios.yml` (the frame vectors against the web encoder; `swift test`
on the core package; XcodeGen and a simulator build of the app) and
`.github/workflows/mero-stream-android.yml` (fetch the SDK, ktlint, detekt, unit tests, Android
lint, `assembleDebug`), each path-filtered to its folder.
