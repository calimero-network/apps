# Mero Tag

Live location sharing on [Calimero](https://calimero.network): an AirTag / Find My-style app where positions
travel through your own Calimero account and its relay, not through a central server.

```
logic/      Rust WASM contract (calimero-sdk)
app/
  MeroTag/  SwiftUI iOS app (MapKit + CoreLocation), built on the official
            Calimero Swift SDK (MeroKit + MeroKitUI)
scripts/    dev-node / dev-node2 / dev-invite / setup / workflows
workflows/  merobox scenarios. The merod image pinned here MUST equal the
            calimero-sdk tag in logic/Cargo.toml; CI fails the pair otherwise.
```

Pinned to core **0.11.0-rc.83**:

- the contract builds against `calimero-sdk` / `calimero-storage` tag `0.11.0-rc.83`
- the merobox workflows run `ghcr.io/calimero-network/merod:0.11.0-rc.83`
- the app uses [`calimero-network/swift-sdk`](https://github.com/calimero-network/swift-sdk) `master`

## How the app talks to Calimero

Sign-in is **Calimero Cloud only**. There is no node URL, username or password.

1. **Continue with Calimero.** The app opens the Calimero wallet in the system sign-in sheet
   (`ASWebAuthenticationSession`). The person approves this device with their passkey.
2. **Return to the app.** The wallet sends the person back to `merotag://enrol` with a device certificate for a key
   that never leaves the phone. The scheme is registered under `CFBundleURLTypes` in `app/MeroTag/project.yml`.
3. **Connect to the relay.** The SDK asks the Cloud manager which hosted relay serves the account, then logs in there.
4. **Talk to the space.** Every contract call goes through that relay, the same way mero-react apps work in Cloud mode:
   - **Writes** (`join`, `create_tracker`, `update_location`, …) are warrant intents (`RelayClient.execute`).
     The device signs each one and the relay executes it.
   - **Reads** (`get_trackers`, `get_presence`, …) are queries (`RelayClient.query`).
   - **Live updates** come over SSE on the relay's Bearer session.
   - If that session can't be established, writes still work and the app refreshes on a timer instead.

The session is kept in the Keychain, so a relaunch skips the wallet. After sign-in, the person picks the name other
members see and opens a **space**: a context inside a namespace. Everything below is the SDK's account layer, signed on
the device; no node is involved.

- **Create a space.** `CloudSignIn.foundNamespace` founds a namespace for this app's package (`com.calimero.mero-tag`,
  resolved in the app registry) through the account's relay, names it, and asks the cloud to host it (HA) so people
  without a node can be admitted. The relay then creates the space's context in it (`RelayClient.createContext`), and
  the app opens it.
- **Invite people.** `CloudSignIn.createNamespaceInvitation` signs an invitation to the space's namespace with this
  device's key, naming the namespace's relays as admitters. It travels as the SDK's `InviteLink`
  (`https://links.calimero.network/com.calimero.mero-tag/join?invitation=…`) through the share sheet; the token also
  carries the context id and the space's name.
- **Join.** Paste the link, or open it as a deep link (`merotag://join?invitation=…`, the scheme the wallet already
  uses). `CloudSignIn.join` redeems it as the account; an account without a relay adopts the one that admits it. The
  app then waits for the space to reach the relay and opens it.

Opening a space by its raw ID is still possible, tucked away at the bottom of the screen (*Open a space by ID*).

## Build and run the app

You need full Xcode 16+ (an iOS 17 SDK) and XcodeGen (`brew install xcodegen`).

```bash
make app-gen      # generate app/MeroTag/MeroTag.xcodeproj from project.yml
make app-run      # build, boot the Simulator, install and launch
make app-test     # unit tests + the sign-in UI smoke test
```

For a device: open `app/MeroTag/MeroTag.xcodeproj` and set your team under *Signing & Capabilities* (or set
`DEVELOPMENT_TEAM` in `project.yml`). Then run.

To build against a local swift-sdk checkout, for example an unmerged SDK branch:

1. In `app/MeroTag/project.yml`, temporarily replace the package's `url` / `branch` with `path: /path/to/swift-sdk`.
2. Run `make app-gen`.
3. Do not commit that change.

> **Until swift-sdk#43 (rc.83 wire) and #44 (Cloud sign-in, RelayClient) are merged**, `master` lacks the APIs the
> app uses. Build against a local checkout that merges both branches.

## Contract

```bash
make setup        # check prereqs, build the WASM + signed dev bundle
make logic-test   # cargo test
make logic-build  # cargo mero build → logic/res/mero_tag.wasm (ABI embedded)
make logic-bundle # signed .mpk a node accepts
make workflows    # merobox scenarios against merod rc.83 in Docker
```

`make node` / `node2` / `invite` still start local dev nodes, for working on the contract and the merobox workflows.
The app doesn't connect to them.

Run `make help` for all targets. [requirements.md](requirements.md) has the full Mac and iPhone walkthrough.

## Status

- Done: the WASM contract (trackers, locations, sharing, groups, geofences, presence, history), built and unit-tested
  on rc.83.
- Done: Cloud sign-in, and writes and reads through the relay, using the official Swift SDK.
- Done: screens in the light Calimero design:
  - sign-in
  - open a space
  - trackers
  - tracker detail with sharing
  - live map with this phone's sharing panel
  - space members and session
- Not yet: creating a space and inviting people from inside the app. This waits on the relay founding and invitation
  API in the Swift SDK. For now, the space owner shares its ID.
- Not yet: authoring geofences, playing back history, and a UI for groups.
