# Mero Chat for Android

A native Jetpack Compose (Material 3) client for Mero Chat, the `com.calimero.chat` app in
[`../../logic`](../../logic). It runs the same contract as the web frontend in
[`../../app`](../../app), so people on Android and on the web share the same workspaces, channels
and messages. It is built on the Calimero Kotlin SDK (`mero-core` + `mero-compose`).

## On Calimero 1.0

The phone runs no node. It signs in with a passkey on a Calimero 1.0 cluster and talks to it over
the SDK's sealed channel (kotlin-sdk `4.0.0`). Contract calls use the component ABI that the web port
(#730) ships in `../../logic/res/abi.json`.

| What | How | SDK |
|---|---|---|
| Sign in | **Calimero Cloud**: the cluster's name (nodes from the node directory) or a node's URL, then the device's passkey (Credential Manager) or a new account. **Development node**: a `merod local` URL with mock attestation, and a software passkey kept on the device | `CalimeroClient.connect(CalimeroConnectOptions(cluster=…))`, `MeroAppSession.signIn` / `signUp` |
| Persist the session | Kept in Keystore-backed encrypted preferences with the node it lives on; restored on launch | `EncryptedSessionStore`, `MeroAppSession.restore` |
| Read and write | Views and calls on `/apps/{app}`, sealed. `ComponentChatContract` maps v1's names and shapes to the ABI's: camelCase, `u64`s as decimal strings | `MeroAppBackend.contract` |
| Create a workspace | Found an org for chat, then `#general` | `foundNamespace` |
| Create a channel | An open channel is an app instance of chat in the org itself, as the web makes them. A private one gets its own team that admits by invitation | `createContext`, `createSubgroup` |
| Invite | An org invite token (a passkey step-up: the Activity's `PlatformPasskey` is the session's `passkey` while it lives) | `createInvitation` |
| Join | Redeem the token (`POST /invites/{token}/redeem`) | `joinNamespace` |
| Approvals | Releases and Mero Chat upgrades that wait for the account show under Approvals. Review shows the request's confirmation code first, then opens the node's consent page in a Custom Tab, which returns to `mero-chat://consent` | `pendingApprovals`, `MeroAppSession.requestConsent` |
| Live updates | The app instance's event stream for the open channel, with polling as the fallback | `MeroAppBackend.events` |

## Features

- Sign in with a passkey (Calimero Cloud or a development node), stay signed in across launches,
  sign out.
- Workspaces: list the account's orgs running chat, create one, join one from an invitation link
  (opened from a browser or chat app, or pasted), share an invitation link. Approvals.
- Channels per workspace: list (joined, open-but-not-joined, unread counts), create (public or
  private), join an open channel on first open. DMs the web app created appear under "Direct
  messages" and open like channels.
- A channel: the newest 20 messages (`get_messages`, the web app's page size), older pages on
  demand by stable index (`get_messages_from`), catch-up of anything missed, send, edit and delete
  your own messages, reactions (`update_reaction`), your name in a channel (`set_profile`),
  `mark_as_read` on open.

Invitation links are the SDKs' `OrgInvitation`:
`https://links.calimero.network/com.calimero.chat/join?invitation=<base58(deflate(payload))>` with
the payload `{"invitation": "inv_…", "namespaceId": "<org>", "name": "<workspace>"}`. The app also
accepts `calimero://com.calimero.chat/join?invitation=…`, the web app's own link
(`https://<its origin>/?invite=inv_…`) and a bare `inv_…` token.

## Build and run

Needs JDK 17 and the Android SDK (platform 34).

```bash
cd apps/mero-chat/mobile/android
./scripts/fetch-sdk.sh            # clone kotlin-sdk at the commit in kotlin-sdk.ref into .sdk/
./gradlew assembleDebug           # app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug            # onto a running emulator or device
```

The gates CI runs (`.github/workflows/mero-chat-android.yml`):

```bash
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

### The SDK pin

The Calimero 1.0 layer the app uses is kotlin-sdk `4.0.0` (`kotlin-sdk.ref` pins its release commit,
`e18ef8a`). That release is not on Maven Central,
so the SDK is built from source as a Gradle composite build: `settings.gradle.kts` includes the
checkout and substitutes it for the `network.calimero:mero-core` / `mero-compose` /
`mero-testkit` coordinates the app declares. Which checkout:

1. `-PmeroKotlinSdkDir=/path/to/kotlin-sdk` (or `meroKotlinSdkDir=` in `~/.gradle/gradle.properties`),
2. else the `MERO_KOTLIN_SDK_DIR` environment variable,
3. else `.sdk/kotlin-sdk`, which `scripts/fetch-sdk.sh` checks out at the SHA in `kotlin-sdk.ref`.

To develop against a local SDK checkout, point option 1 or 2 at it.

To bump the pin, put the new full commit SHA in `kotlin-sdk.ref` and run `./scripts/fetch-sdk.sh`.
The SDK is built in the same Gradle invocation, so the Android Gradle Plugin and Kotlin versions in
`gradle/libs.versions.toml` must equal the SDK's (its `gradle/libs.versions.toml`); compare them on
every bump. Once the SDK is on Maven Central, drop the `includeBuild` block and give the three
catalog entries a real version.

### Pointing it at a cluster

The cluster is chosen on the sign-in screen. `-PmeroCluster=<name or URL>` prefills the Calimero
Cloud field. A development node from the emulator is `http://10.0.2.2:2501` (`merod local`).

A real cluster's passkeys need Digital Asset Links between the app and the cluster's relying
party; they are not set up yet.

## Layout

```
app/src/main/kotlin/network/calimero/chat/
  data/   contract wire models (ChatWire), argument builders (ChatContract), invitation links,
          error copy, ChatBackend + MeroChatBackend (the SDK adapter), ComponentChatContract,
          ChatRepository, MessageWindow
  app/    view models as plain state holders (WorkspacesModel, ChannelsModel, ChannelModel),
          ApprovalsModel, SessionStage, ProfileStore, and the Android ChatAppViewModel that owns the
          MeroAppSession
  ui/     Compose screens and the NavHost
app/src/test/   unit tests; fixtures/ holds contract outputs in the shape serde writes them
```

## Tests

`./gradlew testDebugUnitTest` runs JVM tests against mero-testkit's `InMemoryAppBackend`. They
cover the argument object of every method, the component ABI's wire (names, `u64` strings, answers
back in v1's shapes), result parsing from contract-shaped fixtures, paging (newest page, older
windows by index, gap catch-up), channel creation in the org and in a private team, founding,
invitation links (the SDKs' and the web's), redeeming, approvals with the confirmation code, and
error copy.

## Not supported yet

- Threads: reply counts show, but threads open on the web or desktop only.
- Attachments and avatars: shown by name only; no upload or download.
- Creating a DM: existing DMs open, but starting one needs the web app's DM-subgroup conventions.
- Search, drafts, member lists, roles and moderation, channel info editing, leaving a workspace.
- Presence and typing indicators (the SDK has relay presence intents; not wired up).
- Push notifications: live updates run only while a channel is open.
