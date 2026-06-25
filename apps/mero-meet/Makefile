.PHONY: help setup build logic-build app-install app-build app-typecheck dev workflows clean

help:
	@echo ""
	@echo "  Mero Meet — available targets"
	@echo ""
	@echo "  setup          Build WASM logic + install app deps"
	@echo "  build          Build Rust WASM logic + frontend bundle"
	@echo "  logic-build    Compile logic/src → logic/res/mero_meet.wasm"
	@echo "  app-build      Bundle frontend (app/dist)"
	@echo "  app-typecheck  tsc --noEmit on the frontend"
	@echo "  dev            Vite dev server (desktop opens this in a window)"
	@echo "  workflows      merobox signaling e2e (needs Docker + merobox)"
	@echo "  clean          Remove build artifacts"
	@echo ""

setup: logic-build app-install

logic-build:
	cd logic && ./build.sh

app-install:
	cd app && pnpm install

app-build: app-install
	cd app && pnpm build

app-typecheck:
	cd app && pnpm exec tsc --noEmit

build: logic-build app-build

dev: app-install
	cd app && pnpm dev

# Runs the 2-node signaling e2e. Requires Docker + merobox (`pip install merobox`).
# Run from workflows/ so the `../logic/res/mero_meet.wasm` path resolves.
workflows: logic-build
	cd workflows && merobox bootstrap run e2e.yml

clean:
	cd logic && rm -rf res target
	cd app && rm -rf dist node_modules/.vite
