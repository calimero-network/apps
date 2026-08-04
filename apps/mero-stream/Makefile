.PHONY: help setup build bundle logic-build logic-test logic-bundle app-install app-build app-typecheck app-test dev dev-nodes dev-stop workflows load-curve clean cargo-mero e2e-call e2e-call-headless e2e-call-keep e2e-call-prod e2e-suite

help:
	@echo ""
	@echo "  Mero Stream — streaming media OVER Calimero (Task 3 capacity probe)"
	@echo ""
	@echo "  setup          Build WASM logic + install app deps"
	@echo "  build          Build Rust WASM logic + frontend bundle"
	@echo "  bundle         Build WASM + create signed .mpk release bundle"
	@echo "  logic-build    Compile logic/src → logic/res/mero_stream.wasm"
	@echo "  logic-test     Contract unit tests (native TestHost — determinism/C1..C3)"
	@echo "  logic-bundle   cargo mero bundle → logic/dist/com.calimero.merostream.mpk"
	@echo "  app-build      Bundle frontend (app/dist)"
	@echo "  app-typecheck  tsc --noEmit on the frontend"
	@echo "  app-test       Frontend unit tests (vitest)"
	@echo "  dev            Vite dev server (the /stream dev route)"
	@echo ""
	@echo "  Solo 2-node testing (two local nodes, two browser profiles):"
	@echo "    dev-nodes      Start node1 + node2 + install app + create a stream context"
	@echo "    dev-stop       Stop both dev nodes"
	@echo "  See DEV-TESTING.md."
	@echo ""
	@echo "  Fully automated 480p call (nodes + install + invite + 2 browsers):"
	@echo "    e2e-call            Everything, headed Chrome, torn down after"
	@echo "    e2e-call-headless   Same, headless"
	@echo "    e2e-call-keep       Same, but leave the stack up to poke at"
	@echo "    e2e-call-prod       Against app/dist — the artifact Vercel serves"
	@echo "    e2e-suite           4-scenario 2-node suite (namespace/invite/room) + stream"
	@echo "    cargo-mero          Install/verify cargo-mero pinned to rc.19"
	@echo ""
	@echo "  workflows      merobox 2-node e2e (P2 — needs Docker + merobox>=0.6.49)"
	@echo "  load-curve     P3 load generator usage (drives encode_frame → CSV)"
	@echo "  clean          Remove build artifacts"
	@echo ""

setup: logic-build app-install

# `cargo mero` is the rc.19 app toolchain (core tools/cargo-mero): ABI emit,
# wasm32 build, built-in wasm-opt, ABI section embed, and signed .mpk packaging.
# Pinned to the same release as the SDK git tags in logic/Cargo.toml.
cargo-mero:
	@bash scripts/ensure-cargo-mero.sh

logic-build: cargo-mero
	cd logic && ./build.sh

logic-test:
	cd logic && cargo test

logic-bundle:
	cd logic && ./build-bundle.sh

bundle: logic-bundle

app-install:
	cd app && pnpm install

app-build: app-install
	cd app && pnpm build

app-typecheck:
	cd app && pnpm exec tsc --noEmit

app-test: app-install
	cd app && pnpm test

build: logic-build app-build

dev: app-install
	cd app && pnpm dev

# ── Solo 2-node testing ───────────────────────────────────────────────────────
# Two local nodes both joined to one stream context, so a single dev can push
# frames from one browser profile and watch them decode in the other.
dev-nodes:
	@bash scripts/dev-node.sh
	@bash scripts/dev-node2.sh
	@bash scripts/dev-invite.sh

dev-stop:
	@bash scripts/dev-node2.sh --clean || true
	@bash scripts/dev-node.sh --clean || true

# ── Fully automated two-node 480p call ────────────────────────────────────────
# The one thing the merobox e2e cannot cover: those scenarios use deliberately
# non-H.264 payloads (the app must never parse the bytes, and real access units
# would hide a regression where it started). So the codec ends were untested.
# This drives real Chrome — REQUIRED, since Playwright's bundled Chromium has no
# proprietary codecs and therefore no H.264 at all.
e2e-call:
	@bash scripts/e2e-live-call.sh

e2e-call-headless:
	@bash scripts/e2e-live-call.sh --headless

e2e-call-keep:
	@bash scripts/e2e-live-call.sh --keep

# Runs the same call against app/dist served by `vite preview` — i.e. the exact
# artifact Vercel serves. Worth its own target because the session gate behaves
# differently in a production build: it used to hard-disable the entire UI outside
# Tauri whenever import.meta.env.DEV was false, which would ship a dead page to
# Vercel while every dev-server test stayed green.
# The 4-scenario 2-node suite over the admin API: baseline, namespace invitation +
# join, room as a subgroup with its own context, and node2 self-admitting into it.
# Then streams on the room it built, so the call is proven on a context created
# through the invite path.
e2e-suite:
	@bash scripts/e2e-live-call.sh --via-invite --headless

e2e-call-prod:
	@bash scripts/e2e-live-call.sh --prod --headless

# P2: all three e2e scenarios over merobox. Requires Docker + merobox>=0.6.49.
# Each runs as its own CI matrix leg (.github/workflows/ci.yml). Run sequentially
# here so a laptop isn't hosting seven nodes at once; the port bases differ
# (2760/2780/2800) so they would not clash if you do parallelize them.
workflows: logic-build
	cd workflows && merobox bootstrap run e2e.yml
	cd workflows && merobox bootstrap run e2e-tombstones.yml
	cd workflows && merobox bootstrap run e2e-fanout.yml
	cd workflows && merobox bootstrap run e2e-live-chunks.yml

# P3: the load curve. Needs a running context — `make workflows` leaves two nodes
# up and prints the context id + both member keys, or use `make dev-nodes`.
# Stdlib python3 only; see the script's --help for the full flag set.
load-curve:
	@echo "Usage: python3 scripts/load-curve.py --node-url http://localhost:2660 \\"
	@echo "         --context-id <ctx> --executor-key <sender-pk> \\"
	@echo "         --peer-url http://localhost:2661 --peer-executor-key <peer-pk> \\"
	@echo "         --peer-container calimero-node-2 --out load-curve.csv"
	@echo ""
	@python3 scripts/load-curve.py --help

clean:
	cd logic && rm -rf res target
	cd app && rm -rf dist node_modules/.vite
