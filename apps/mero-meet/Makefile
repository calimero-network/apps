.PHONY: help setup build bundle logic-build logic-bundle app-install app-build app-typecheck dev dev-nodes dev-call dev-e2e dev-invite-test dev-stop workflows clean

help:
	@echo ""
	@echo "  Mero Meet — available targets"
	@echo ""
	@echo "  setup          Build WASM logic + install app deps"
	@echo "  build          Build Rust WASM logic + frontend bundle"
	@echo "  bundle         Build WASM + create signed .mpk release bundle"
	@echo "  logic-build    Compile logic/src → logic/res/mero_meet.wasm"
	@echo "  logic-bundle   Build WASM + sign + package logic/res/mero-meet-<ver>.mpk"
	@echo "  app-build      Bundle frontend (app/dist)"
	@echo "  app-typecheck  tsc --noEmit on the frontend"
	@echo "  dev            Vite dev server (desktop opens this in a window)"
	@echo ""
	@echo "  Solo call testing (two local nodes, two browser profiles):"
	@echo "    dev-nodes        Start node1 + node2 + create room + auto-invite (one shot)"
	@echo "    dev              (in another terminal) Vite dev server"
	@echo "    dev-call         Open two fake-camera Chrome profiles into the room"
	@echo "    dev-e2e          HEADLESS asserted call lifecycle (join/media/leave/rejoin/die)"
	@echo "    dev-invite-test  Clean slate; node2 left UNjoined to test the in-app invite flow"
	@echo "    dev-stop         Stop both dev nodes"
	@echo "  See DEV-TESTING.md."
	@echo ""
	@echo "  workflows      merobox signaling e2e (needs Docker + merobox)"
	@echo "  clean          Remove build artifacts"
	@echo ""

setup: logic-build app-install

logic-build:
	cd logic && ./build.sh

logic-bundle:
	cd logic && ./build-bundle.sh

bundle: logic-bundle

app-install:
	cd app && pnpm install

app-build: app-install
	cd app && pnpm build

app-typecheck:
	cd app && pnpm exec tsc --noEmit

build: logic-build app-build

dev: app-install
	cd app && pnpm dev

# ── Solo call testing ─────────────────────────────────────────────────────────
# Two local nodes both joined to one room, so a single dev can place a real call
# between two browser profiles (fake cameras). See DEV-TESTING.md.
dev-nodes:
	@bash scripts/dev-node.sh
	@bash scripts/dev-node2.sh
	@bash scripts/dev-invite.sh

dev-call:
	@bash scripts/dev-call.sh

# Headless, ASSERTED call lifecycle over the same two dev nodes: join → media
# both ways → leave → rejoin (both directions) → everyone leaves → call dies.
# Needs dev-nodes + a running vite (make dev). DEV_VITE_PORT overridable.
dev-e2e:
	@bash scripts/dev-e2e.sh

# Clean slate for testing the in-app invite flow: node2 is NOT auto-joined, so
# peer A mints an invite in the UI and peer B pastes it on the Rooms page.
dev-invite-test:
	@bash scripts/dev-invite-test.sh

dev-stop:
	@bash scripts/dev-node2.sh --clean || true
	@bash scripts/dev-node.sh --clean || true

# Runs the 2-node signaling e2e. Requires Docker + merobox (`pip install merobox`).
# Run from workflows/ so the `../logic/res/mero_meet.wasm` path resolves.
workflows: logic-build
	cd workflows && merobox bootstrap run e2e.yml

clean:
	cd logic && rm -rf res target
	cd app && rm -rf dist node_modules/.vite
