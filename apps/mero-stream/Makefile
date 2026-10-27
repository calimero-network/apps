.PHONY: help setup build bundle logic-build logic-test logic-bundle app-install app-build app-typecheck app-test dev load-curve clean cargo-mero shots

help:
	@echo ""
	@echo "  Mero Stream — streaming media OVER Calimero (Task 3 capacity probe)"
	@echo ""
	@echo "  setup          Build WASM logic + install app deps"
	@echo "  build          Build Rust WASM logic + frontend bundle"
	@echo "  bundle         Build WASM + create signed .mpk release bundle"
	@echo "  logic-build    Compile logic/src → logic/res/mero_stream.wasm"
	@echo "  logic-test     Contract unit tests (native TestHost — determinism/C1..C3)"
	@echo "  logic-bundle   cargo mero bundle → logic/dist/com.calimero.mero-stream.mpk"
	@echo "  app-build      Bundle frontend (app/dist)"
	@echo "  app-typecheck  tsc --noEmit on the frontend"
	@echo "  app-test       Frontend unit tests (vitest)"
	@echo "  dev            Vite dev server (the /stream dev route)"
	@echo ""
	@echo "  Solo 2-node testing (two local nodes, two browser profiles):"
	@echo "  See docs/DEV-TESTING.md."
	@echo ""
	@echo "  Fully automated 480p call (nodes + install + invite + 2 browsers):"
	@echo "    shots               Screenshot every call-UI state (no node, no camera)"
	@echo "    cargo-mero          Install/verify cargo-mero pinned to rc.20"
	@echo ""
	@echo "  load-curve     P3 load generator usage (drives encode_frame → CSV)"
	@echo "  clean          Remove build artifacts"
	@echo ""

setup: logic-build app-install

# `cargo mero` is the rc.20 app toolchain (core tools/cargo-mero): ABI emit,
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

# `tsc -b`, NOT `tsc --noEmit`. app/tsconfig.json is a solution file: `"files": []`
# plus references to tsconfig.app.json / tsconfig.node.json. So `tsc --noEmit`
# resolves that root config, finds no files, and exits 0 having checked NOTHING —
# this gate passed while `pnpm build` (which runs `tsc -b`) was failing on two real
# type errors. Both referenced projects already set `noEmit: true`, so build mode
# writes nothing but .tsbuildinfo.
app-typecheck:
	cd app && pnpm exec tsc -b --force

app-test: app-install
	cd app && pnpm test

build: logic-build app-build

dev: app-install
	cd app && pnpm dev

# ── Fully automated two-node 480p call ────────────────────────────────────────
# The one thing the merobox e2e cannot cover: those scenarios use deliberately
# non-H.264 payloads (the app must never parse the bytes, and real access units
# would hide a regression where it started). So the codec ends were untested.
# This drives real Chrome — REQUIRED, since Playwright's bundled Chromium has no
# proprietary codecs and therefore no H.264 at all.
# Screenshots of the call UI in every state, with NO node and NO camera: the
# harness in app/e2e/shots/ aliases the two hooks that need them and renders the
# production CallPage / DataDialog / CSS. Output lands in data/shots/, which is
# gitignored -- these are review artifacts, not source.
shots:
	@cd app && pnpm exec node e2e/shots.mjs

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
