# Mero Meet

Decentralized, peer-to-peer **video calling** on Calimero.

Mero Meet splits a video call into two planes:

- **Control plane — this WASM contract.** A Calimero context is the room. The
  contract holds lobby **presence** ("find people"), the **call roster**, and
  acts as the **WebRTC signaling relay** (`post_signal` / `get_signals`). It
  replaces the dedicated signaling server (Prosody/XMPP in Jitsi) with
  decentralized, replicated CRDT state — *no signaling server*.
- **Media plane — WebRTC, peer-to-peer.** The live audio/video never touches
  the contract or the gossip layer (far too slow for the <150 ms latency
  budget). It flows directly between participants over WebRTC. In the Calimero
  desktop app this runs in the webview's native WebRTC stack; a bundled TURN
  relay handles NAT fallback.

```
   Calimero context "room"  (this contract)
   ├─ presence  : who's here, status, mic/camera   ← the lobby
   ├─ signals   : opaque SDP/ICE blobs, peer→peer   ← the WebRTC handshake
   └─ call       : the active media-session roster
            │ SSE: SignalPosted / PresenceChanged
            ▼
   Frontend (app/) — lobby + call UI; WebRTC mesh in the webview
            │
            └── media ═══ direct peer-to-peer ═══►  (never via the contract)
```

## Layout

| Path | What |
|------|------|
| `logic/` | Rust WASM contract — presence, signaling relay, call sessions, roles |
| `app/`   | React frontend — Tauri-gated; landing page on the web, lobby + call in desktop |
| `workflows/` | merobox 2-node e2e proving signaling rides the contract |

## Desktop-only

Mero Meet needs the Calimero desktop app (tauri-app) for its node, SSO, and
media bridge. On the plain web the frontend renders a **landing page** pointing
users to the desktop app (`app/src/pages/LandingPage.tsx`); the call UI is gated
behind `IS_TAURI` (`app/src/lib/tauri.ts`). tauri-app opens the app in a window
with auth + room context in the URL hash, exactly like the other mero apps.

## Build & run

```bash
make setup        # build WASM + install frontend deps
make build        # WASM + frontend bundle
make app-typecheck
make dev          # Vite dev server (the desktop app opens this URL)
make workflows    # 2-node signaling e2e (needs Docker + merobox)
```

The contract compiles to `logic/res/mero_meet.wasm`. Build deps follow the
calimero rc.7 convention: `calimero-sdk` / `-storage` / `-storage-macros` are
git-tag deps on `core.git` (`tag = "0.11.0-rc.7"`), not crates.io versions.

## Contract API (RPC)

| Method | Purpose |
|--------|---------|
| `init(name)` | Create the room; caller becomes host (admin + owner). |
| `join(username, now)` | Enter the lobby / refresh profile. |
| `heartbeat(now)` | Liveness (silent CRDT write, no event). |
| `set_state(muted?, video_on?, status?, now)` | Update mic/camera/status. |
| `leave(now)` | Leave the room. |
| `get_lobby(now)` | Read presence + room info + who's online. |
| `start_call(now)` → `call_id` | Start / join the active call session. |
| `leave_call(now)` / `end_call()` | Leave (host can end for all). |
| `get_call_participants()` | The media-session roster. |
| `post_signal(to, kind, payload, call_id, now)` → `seq` | Relay an opaque SDP/ICE blob to a peer. |
| `get_signals(after_seq)` | Drain signals addressed to me, ordered. |
| `grant_host` / `revoke_host` / `is_member_host` | Host role management. |

> Publishing to the app registry needs a `logic/calimero.json` keypair
> (`meroctl app gen-key` / copy the pattern from another mero app). It is not
> required for local `dev: true` installs or the merobox workflow.
