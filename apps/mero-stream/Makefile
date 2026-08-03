.PHONY: help setup build bundle logic-build logic-test logic-bundle app-install app-build app-typecheck app-test dev dev-nodes dev-stop workflows load-curve clean

help:
	@echo ""
	@echo "  Mero Stream — streaming media OVER Calimero (Task 3 capacity probe)"
	@echo ""
	@echo "  setup          Build WASM logic + install app deps"
	@echo "  build          Build Rust WASM logic + frontend bundle"
	@echo "  bundle         Build WASM + create signed .mpk release bundle"
	@echo "  logic-build    Compile logic/src → logic/res/mero_stream.wasm"
	@echo "  logic-test     Contract unit tests (native TestHost — determinism/C1..C3)"
	@echo "  logic-bundle   Build WASM + sign + package logic/res/mero-stream-<ver>.mpk"
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
	@echo "  workflows      merobox 2-node e2e (P2 — needs Docker + merobox>=0.6.49)"
	@echo "  load-curve     P3 load generator usage (drives encode_frame → CSV)"
	@echo "  clean          Remove build artifacts"
	@echo ""

setup: logic-build app-install

logic-build:
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

dev-stop:
	@bash scripts/dev-node2.sh --clean || true
	@bash scripts/dev-node.sh --clean || true

# P2: all three e2e scenarios over merobox. Requires Docker + merobox>=0.6.49.
# Each runs as its own CI matrix leg (.github/workflows/ci.yml). Run sequentially
# here so a laptop isn't hosting seven nodes at once; the port bases differ
# (2760/2780/2800) so they would not clash if you do parallelize them.
workflows: logic-build
	cd workflows && merobox bootstrap run e2e.yml
	cd workflows && merobox bootstrap run e2e-tombstones.yml
	cd workflows && merobox bootstrap run e2e-fanout.yml

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
