# Mero Meet — self-hosted TURN setup (AWS)

This stands up an **independent** STUN + TURN relay so calls connect even when both
peers are behind symmetric NAT / CGNAT (the `→ failed` case). It is **fully
self-owned**: no Google, no third-party TURN. It runs on its **own EC2 instance,
own security group, own DNS name** and never touches the existing Calimero relayer.

```
desktop app ──GET /ice (bearer)──▶ Caddy(443) ─▶ ice-cred ──┐ mints HMAC creds
        │                                                    │
        └──────── STUN/TURN (3478, 49152-65535) ───▶ coturn ◀┘ same shared secret
```

---

## Why this is independent from the relayer

- **Separate instance.** Don't co-locate with `merod`. New box, new lifecycle.
- **Separate security group.** Do **not** edit the relayer's SG.
- **No path inward.** `turnserver.conf` denies relaying to all private/link-local
  ranges (`10/8`, `172.16/12`, `192.168/16`, `169.254/16`, …), so this box cannot
  be used to reach the relayer, other internal hosts, or the EC2 metadata service.
  Only public peer IPs (real call participants) are relayable.

---

## What you need

| Resource | Spec | Notes |
|---|---|---|
| EC2 instance | `t3.small`, Ubuntu 22.04 LTS, 20 GB gp3 | Plenty for ~10 concurrent 1:1 calls. CPU is idle; coturn just forwards UDP. |
| Elastic IP | 1, associated to the instance | Stable public IP for DNS + coturn `external-ip`. |
| Security Group | 1, dedicated (rules below) | Brand new — not the relayer's. |
| DNS A record | `turn.<your-domain>` → Elastic IP | e.g. `turn.calimero.network`. Needed for Let's Encrypt + clients. |
| Software on box | Docker + Docker Compose plugin | Installed in step 3. |

### Security group ingress

| Port | Proto | Source | Purpose |
|---|---|---|---|
| 22 | TCP | **your IP /32** | SSH |
| 80 | TCP | 0.0.0.0/0 | Let's Encrypt HTTP-01 challenge |
| 443 | TCP | 0.0.0.0/0 | `https://turn…/ice` credential endpoint |
| 3478 | TCP + UDP | 0.0.0.0/0 | STUN + TURN |
| 49152–65535 | UDP | 0.0.0.0/0 | TURN relay range |
| 5349 | TCP + UDP | 0.0.0.0/0 | *(Phase 2 only)* TURN over TLS |

Egress: allow all (default).

---

## Setup — manual

```bash
# 1. SSH in, install Docker
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker

# 2. Get this directory onto the box
git clone https://github.com/calimero-network/mero-meet.git
cd mero-meet/turn

# 3. Configure
cp .env.example .env
#   TURN_SECRET / ICE_API_KEY : openssl rand -hex 32   (one each)
#   TURN_DOMAIN               : turn.<your-domain>
#   PUBLIC_IP                 : the Elastic IP
#   PRIVATE_IP                : `ip -4 addr` / EC2 metadata local-ipv4
nano .env

# 4. Point DNS: turn.<your-domain>  A  <Elastic IP>   (wait for it to resolve)

# 5. Render coturn config from .env and launch
./setup.sh
docker compose up -d
docker compose logs -f          # watch caddy get a cert, coturn bind
```

---

## Wire the desktop app

The desktop app already calls `get_ice_servers` and injects whatever it returns
into WebRTC — **no UI / no per-user config**. Set two env vars for the desktop
build/runtime (see the matching PR on `tauri-app`):

```
CALIMERO_ICE_ENDPOINT=https://turn.<your-domain>/ice
CALIMERO_ICE_ENDPOINT_KEY=<the ICE_API_KEY from .env>
```

When set and reachable, the endpoint's response is authoritative (STUN + TURN with
fresh credentials). If it's ever down, the app falls back to static config, then to
plain STUN — a call is never blocked by a momentarily-unreachable endpoint.

---

## Verify

```bash
# Credential endpoint returns STUN+TURN with fresh creds:
curl -s -H "Authorization: Bearer $ICE_API_KEY" https://turn.<your-domain>/ice | jq

# Relay actually works: paste the turn: URL + username/credential into
# https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
# — you must see at least one candidate of type "relay".
```

Then reopen Mero Meet from desktop and rejoin the call that showed `→ failed`. The
diagnostics panel should now show the peer reaching `connected` instead of `failed`.

---

## Capacity (this sizing)

coturn does no transcoding — it forwards UDP. The limit is bandwidth/egress, not CPU.

- **10 concurrent 1:1 calls, worst case 100 % relayed:** ~60 Mbps aggregate. A
  `t3.small` is overkill; the real cost is AWS egress (~$0.09/GB → cents/hr at this
  scale, since typically only ~20–30 % of calls actually need the relay).
- **Mesh ceiling:** Mero Meet is full-mesh, so *group* calls cost N×(N-1) streams.
  Fine to ~4–5 participants/call. Bigger group calls need an SFU — a separate
  project, not a TURN change.

---

## Phase 2 (hardening, optional)

- **turns: over TLS (port 5349).** Lets calls punch through firewalls that block
  UDP entirely. Mount a cert into coturn (reuse Caddy's, or certbot), uncomment the
  `tls-listening-port` + `cert`/`pkey` lines in `coturn/turnserver.conf`, set
  `ENABLE_TURNS=true`, re-run `./setup.sh && docker compose up -d`.
- **Rotate `TURN_SECRET` / `ICE_API_KEY`** periodically.
