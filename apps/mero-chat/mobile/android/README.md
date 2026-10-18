# Mero Chat for Android

A native Jetpack Compose (Material 3) client for Mero Chat, the `com.calimero.chat` app in
[`../../logic`](../../logic). It runs the same contract as the web frontend in
[`../../app`](../../app), so people on Android and on the web share the same workspaces, channels
and messages. It is built on the Calimero Kotlin SDK (`mero-core` + `mero-compose`).

## Delegated execution only

The phone runs no node, and the app has no node-login screen, admin password or "node URL"
setting. It signs in with a Calimero account, and the account's hosted relay works on its behalf:

| What | How | SDK |
|---|---|---|
| Sign in | The Calimero wallet (passkey, in a Custom Tab) certifies a key this device generated; the certificate comes back on the enrolment callback | `MeroClient.signInWithCloud` / `handleEnrolmentCallback` |
| Find the relay | The cloud manager's account relay list | `CloudAccount.findRelay` (`getAccountRelays`) |
| Persist the session | Keys, session and warrant nonces in Keystore-backed EncryptedSharedPreferences; restored on launch | `MeroClient.create` / `restore` |
| Read (views) | `POST /admin-api/contexts/{ctx}/query` as the account, over the relay session | `RelayClient.query` (`RelayClient.call` until the relay is attested) |
| Write | A warrant signed by the device key, `POST /admin-api/contexts/{ctx}/intents`. Never `/jsonrpc` | `RelayClient.execute` |
| Create a workspace | Found a namespace running chat through the relay, then create `#general` | `MeroClient.foundNamespace` |
| Create a channel | Its own subgroup (root governance op), then chat's context in it with a creation warrant (`/groups/{g}/context-intents`), in the web app's one-group-per-channel model | account admin `createGroupInNamespace`, `createContext` |
| Invite | An invitation signed by this device, shared as the web app's link | `MeroClient.createNamespaceInvitation` |
| Join | Direct admission at a relay the invitation names (`POST /admin-api/namespaces/{id}/admit`) | `MeroClient.joinWithInvitation` |
| Live updates | The relay's event stream (SSE over the relay session) for the open channel. Before the relay is attested there is no stream, so the channel polls every 5 s | `Mero.events` |

A brand-new account belongs to nothing, so no relay serves it yet. The app then asks the person to
open an invitation link; joining gives the account its relay.

## Features

- Sign in with a Calimero account, stay signed in across launches, sign out.
- Workspaces: list the account's namespaces running chat, create one, join one from an
  invitation link (opened from a browser or chat app, or pasted), share an invitation link.
- Channels per workspace: list (joined, open-but-not-joined, unread counts), create (public or
  private), join an open channel on first open. DMs the web app created appear under "Direct
  messages" and open like channels.
- A channel: the newest 20 messages (`get_messages`, the web app's page size), older pages on
  demand by stable index (`get_messages_from`), catch-up of anything missed, send, edit and delete
  your own messages, reactions (`update_reaction`), your name in a channel (`set_profile`),
  `mark_as_read` on open.

Invitation links use the web app's format, so a link from either side opens on the other:
`https://links.calimero.network/com.calimero.chat/join?invitation=<base58(deflate(payload))>`
with the payload `{"invitation": <signed invitation>, "groupAlias": "<workspace name>"}`. The app
also accepts the `calimero://com.calimero.chat/join?invitation=…` form and bare tokens.

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

The delegated layer the app uses is only on the SDK's default branch, not in a published release,
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

### Pointing it at another environment

All optional; empty means the SDK's defaults (the hosted Calimero cloud, wallet and app registry).
Pass them with `-P` or put them in `gradle.properties`:

| Property | What |
|---|---|
| `meroCloudUrl` | Cloud manager base URL (relay discovery, routing, hosting) |
| `meroWalletUrl` | Wallet enrolment page |
| `meroRegistryUrl` | App registry that resolves `com.calimero.chat` to its application id |
| `meroEnrolCallback` | Where the wallet sends the person back. Default `mero-chat://enrol`; the manifest's intent filter is generated from its scheme and host |

```bash
./gradlew installDebug -PmeroCloudUrl=https://cloud.staging.example -PmeroWalletUrl=https://wallet.staging.example/account-enroll
```

**Sign-in callback.** The SDK README notes that the hosted wallet currently redirects only to
`https://` callbacks; app-scheme callbacks such as `mero-chat://enrol` need a pending mero-wallet
change. Until then, production sign-in needs an https App Link: set `meroEnrolCallback` to that
URL, publish `assetlinks.json` for `network.calimero.chat` on its host, and add an `autoVerify`
intent filter for it in `app/src/main/AndroidManifest.xml`.

## Layout

```
app/src/main/kotlin/network/calimero/chat/
  data/   contract wire models (ChatWire), argument builders (ChatContract), invitation links,
          error copy, ChatBackend + MeroChatBackend (the SDK adapter), ChatRepository, MessageWindow
  app/    view models as plain state holders (WorkspacesModel, ChannelsModel, ChannelModel),
          SessionStage, ProfileStore, and the Android ChatAppViewModel that owns the MeroClient
  ui/     Compose screens and the NavHost
app/src/test/   unit tests; fixtures/ holds contract outputs in the shape serde writes them
```

## Tests

`./gradlew testDebugUnitTest` runs JVM tests against the SDK's test support: the real `MeroClient`
signed in through a mock wallet, talking to mero-testkit's `FakeNode`/`FakeCloud` (cloud manager +
hosted relay on MockWebServer). They cover the argument object of every method against the web
app's, result parsing from contract-shaped fixtures, paging (newest page, older windows by index,
gap catch-up), that views go to `/query` and writes to `/intents` as warrants (and nothing to
`/jsonrpc`), channel creation through `context-intents`, founding, invitation links in both
directions, and joining by direct admission.

## Not supported yet

- Threads: reply counts show, but threads open on the web or desktop only.
- Attachments and avatars: shown by name only; no upload or download.
- Creating a DM: existing DMs open, but starting one needs the web app's DM-subgroup conventions.
- Search, drafts, member lists, roles and moderation, channel info editing, leaving a workspace.
- Presence and typing indicators (the SDK has relay presence intents; not wired up).
- Push notifications: live updates run only while a channel is open.
