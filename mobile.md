# Mobile: which apps to port, and how far

Only Mero Chat has native clients today (`apps/mero-chat/mobile`, SwiftUI on
[swift-sdk](https://github.com/calimero-network/swift-sdk) and Compose on
[kotlin-sdk](https://github.com/calimero-network/kotlin-sdk)). Every other app is
web only. This file sorts the rest by what a phone can reasonably do with them,
following the same model: delegated execution through the account's relay, no
node on the phone.

The rule of thumb: **port what is lists, forms and taps; ship view-only for
canvas editors; give games touch controls; skip probes.** iOS and Android ship
together and stay identical.

## Tier 1: full native port

Small contracts, list/form UI, nothing a phone can't do well. These come first.

| App | What the phone gets | Contract | Notes |
| --- | --- | --- | --- |
| **mero-forum** | Everything: feed, post, comment, vote, moderation | 18 methods, 1 context | Twitter-style feed; the easiest win after chat |
| **mero-standup** | Everything: post a standup, read the team's, decision log | 19 methods | Daily-use, perfect phone habit |
| **mero-chess** | Everything: tables, play (tap-tap moves), draw offers, rematch | 14 methods, 1 context per table | Rules live in the contract, the board is a simple grid |
| **mero-calendar** | Everything: month/week/day, create/edit events, private events | 11 methods, uses `#[app::private]` | Native date pickers and calendar views; already the most responsive web app |
| **mero-issue-tracker** | Everything: list, board (status change by menu, not drag), issue detail, comments | 20 methods | Board drag becomes a "Move to…" action |
| **mero-updates** | Read updates, react, Q&A, asks/offers; posting with a plain editor | 38 methods, uses `app::private` | Large API but all content and forms |
| **battleships** | Everything: lobby, place ships, play | 2 services (lobby 9, game 12) | Needs the multi-service bundle flow and a SHA-256 commit-reveal (CryptoKit has it); board and salt stay in private storage |

## Tier 2: native, with platform work

UI is simple; the hard part is crypto, push or volume of API.

| App | What the phone gets | The extra work |
| --- | --- | --- |
| **mero-pass** | Everything, and better than web: vaults, secrets, devices, plus **AutoFill** (iOS Credential Provider / Android Autofill Service) | Reimplement the key-wrap layer natively (~30 `crypto.subtle` uses in `@calimero-network/mero-pass`); passkeys map to platform passkeys. Must be byte-compatible with web vaults: share test vectors with the JS lib |
| **mero-vote** | Vote, see verifiable tallies; take part in a DKG ceremony | Port the threshold crypto (`@noble/curves` / `@noble/hashes`) or share one Rust core through FFI. Must match the web client's ballots exactly |
| **hyperfeed** | Notification feed, approve/undo, rules, chat with the agent | 84 methods (largest contract). Web push (VAPID) becomes **APNs/FCM**, which needs a push relay; the "phone alerts" story only works with it |
| **mero-crm** | Pipeline as a stage list (or swipeable columns), deals, contacts, to-dos | 33 methods, many screens. Kanban drag becomes "Move to stage". Automations: read-only on phone |

## Tier 3: view-only (plus light actions)

Canvas and document editors. Making them editable on a phone is a rewrite for
very little use; people want to **look**, **comment** and **share** from a phone.

| App | Phone scope | How |
| --- | --- | --- |
| **mero-design** | View boards (pan/zoom), present mode, read and add comments, see live cursors | Render the scene read-only; a `WKWebView`/`WebView` running the web renderer in a view-only mode is the cheapest path (fabric.js). No shape editing |
| **mero-pixart** | View the composed image, layer list (show/hide locally), export/share, comments | Composite on the web side or decode the flattened blob; no layer editing, masks or curves |
| **mero-models** | Orbit/zoom the model, see who has what checked out, comments | three.js in a WebView, or SceneKit/Filament for a read-only mesh viewer. No editing or check-out |
| **mero-docs** | Read docs and folders, comment on blocks; **later** plain-text edits | BlockNote/ProseMirror CRDT deltas are web-only; native rendering of blocks read-only, editing later via a WebView editor |
| **mero-sheets** | View sheets and tabs, charts; edit a single cell's value | The recalc engine is Rust (`recalc-wasm`), so it can be compiled natively for iOS/Android instead of WASM if edits grow; formula authoring stays on web |
| **mero-sign** | Review and **sign** an agreement you were sent (view PDF, draw signature, consent) | PDFKit / Android `PdfRenderer` for viewing, a signature pad for drawing. Uploading, placing fields and the TensorFlow semantic search stay web-only. Multi-context identity mapping is the hard part |

## Tier 4: games with touch controls

| App | Phone scope | How |
| --- | --- | --- |
| **mero-blocks** | Playable "mobile Minecraft": left thumb **virtual joystick** to move, right side **drag to look**, buttons for jump / place / break / hotbar | three.js engine in a WebView with a touch-control overlay replacing PointerLock + keyboard; native shell handles sign-in and the relay. A native engine port is not worth it |
| **merraria** | Playable: on-screen **D-pad + jump + mine/place** buttons, tap-to-target | Light Canvas2D engine, so a WebView is fine; keyboard-only today, so the touch layer is the whole job |
| **mero-kombat** | Playable: the existing on-screen keycaps become a fight pad | Already has touch keycaps; WebView plus landscape lock. Latency over presence is the risk; test on cellular |

## Not porting

| App | Why |
| --- | --- |
| **mero-stream** | A capacity probe for A/V over the contract; the README already says the real answer is WebRTC ("Mero Meet"). A native Meet app is its own project |
| **kv-store** | Reference app; it belongs in the SDK sample apps (swift-sdk `Examples/`, kotlin-sdk sample), not as a product |
| conformance, delegated-execution, scaffolding-e2e | Test and scaffolding, not user-facing |

## Shared prerequisites (in the SDKs, before Tier 2 and beyond)

These block several apps at once, so they come before the app work:

1. **Blobs over the relay.** Both SDKs have blob upload and download through the relay (swift-sdk #79, kotlin-sdk #57); Mero Chat's attachments and avatars and all of Tier 3 can build on it.
2. **Push.** APNs/FCM delivery for relay events (chat mentions, hyperfeed approvals, standup reminders, your turn in chess and battleships). Today the apps use SSE while open and 5-second polling otherwise.
3. **Multi-service bundles and multi-context identity** (battleships, mero-docs, mero-sign).
4. **A WebView host kit:** one native shell (sign-in, relay session, deep links) that hosts a web app's view-only or game mode and bridges contract calls to the SDK. Tier 3 and Tier 4 mostly reuse it, so it is built once.
5. **Universal links** on `links.calimero.network` for every app's invitations, and an https wallet callback (both are open in Mero Chat).

## How we build them: one template, not ten hand-written apps

Mero Chat mobile is ~10k lines across both platforms, and very little of it is chat. The cost is
that everything is written twice by hand:

- **The contract layer.** `ChatAPI.swift` and `ChatContract.kt` copy method names, argument keys
  and limits by hand from `lib.rs` and the web data source. The web apps generate theirs from
  `logic/res/abi.json` with `calimero-abi-codegen`, and every app here has that ABI.
- **The session.** Chat's `SessionModel` / `ChatBackend` (Cloud sign-in, relay lookup, restore,
  deep links, invitations, namespaces, SSE with polling fallback) is generic, and MeroKitUI /
  mero-compose already hold most of the pieces.
- **The test rig and project setup.** Fakes, the live relay rig, XcodeGen, Gradle, SDK pins and two
  CI workflows, all per app.

So before Tier 1, three things move out of the apps:

1. **SDKs: `ContextContract` and `MeroAppSession`.** `ContextContract` is relay query for views
   and warrant intents for writes, bound to a context as `ContextContractCalling`.
   `MeroAppSession` is chat's session minus chat: sign-in, restore, deep links, namespaces,
   subgroups, contexts, invitations, live events. In-memory fakes go in MeroKitTestSupport /
   mero-testkit. Swift and Kotlin get the same API. Chat then migrates onto it.
2. **Codegen: `calimero-abi-codegen --target swift|kotlin`.** Codable / `@Serializable` types for
   every ABI type and a typed async client per app, calling `ContextContractCalling`. Same wire
   shape as the TS client (optional arguments omitted, not `null`). Chat's hand-written contract
   layer is deleted in favour of it.
3. **Template: `scripts/new-mobile-app <app>`.** Scaffolds `apps/<app>/mobile/{ios,android,e2e}`:
   project files, SDK pins, generated clients, a root view on `MeroAppSession`, a test target on
   the fakes, and CI through one reusable workflow per platform. Shared Calimero-styled components
   (rows, empty/error states, composer, avatar, icons) live in MeroKitUI / mero-compose.

After that, a Tier 1 app is its generated client, its view models and its screens. mero-forum is
the pilot for the template. The WebView host kit for Tiers 3 and 4 is built on `MeroAppSession`,
with a bridge so the web app's generated client calls through the native session.

## Suggested order

1. SDK `ContextContract` + `MeroAppSession` and native codegen (in parallel); chat migrates onto both.
2. The `new-mobile-app` template and shared components.
3. Finish Mero Chat (threads, attachments, DMs, push, glass design) on the template; see below.
4. SDK: push and the WebView host kit.
5. Tier 1: mero-forum (pilot), mero-standup, mero-chess, mero-calendar (then the rest of Tier 1).
6. mero-pass with AutoFill (the strongest reason to install a phone app).
7. Tier 4 games on the host kit (mero-blocks first), then Tier 3 viewers.

## Mero Chat on iOS: where it stands (2026-10-26)

- **SDK:** pinned by commit; bumped to swift-sdk `6f97c85` (main: schema-27 namespace ops for core 0.11.0, registry installs the newest version the relay runtime accepts). No tagged release carries the delegated layer yet; once one does, switch `revision:` to `from:`.
- **Tests:** 55 logic tests pass on the simulator. The live tests (`MeroChatLiveTests`) need `mobile/e2e/run-relay.sh` and skip without it.
- **Design:** stock SwiftUI (system list styles, default accent). It does not use the web app's glass light/dark theme or Calimero branding yet.
- **Features vs web:** sign-in, workspaces (create, join, invite), channels (create, join open ones), DMs (open existing), paged history, send/edit/delete, reactions, display name, unread counts. **Missing:** threads, attachments and avatars, starting a DM, search, drafts, mentions, roles/moderation, channel settings, leaving, presence/typing, notifications, theme switch.
