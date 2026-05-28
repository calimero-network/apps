.PHONY: help setup install build dev dev-node dev-node2 start stop \
        logic-build app-install app-build app-typecheck app-lint \
        test unit e2e workflows workflows-no-build clean

# ── Help ───────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  MeroDesign — available targets"
	@echo ""
	@echo "  Setup"
	@echo "    setup          Check prereqs, build logic, install app deps"
	@echo "    dev-node       Start node1 with full workspace setup"
	@echo "    dev-node2      Start node2 only (invite from webapp)"
	@echo "    install        Install frontend dependencies (pnpm)"
	@echo ""
	@echo "  Build"
	@echo "    build          Build Rust WASM logic + frontend"
	@echo "    logic-build    Compile logic/src → logic/res/merodesign.wasm"
	@echo "    app-build      Bundle frontend (dist/)"
	@echo ""
	@echo "  Dev"
	@echo "    start          Node1 + node2 (auto-invited) + frontend"
	@echo "    dev            Start Vite dev server (http://localhost:5173)"
	@echo "    stop           Stop all dev nodes and free ports"
	@echo ""
	@echo "  Quality"
	@echo "    app-typecheck  Run tsc --noEmit"
	@echo "    app-lint       Run ESLint"
	@echo ""
	@echo "  Test"
	@echo "    test           Unit + e2e tests"
	@echo "    unit           Vitest unit tests"
	@echo "    e2e            Playwright e2e tests"
	@echo "    workflows      merobox workflow tests"
	@echo ""
	@echo "  Other"
	@echo "    clean          Remove all build artifacts"
	@echo ""

# ── Setup ──────────────────────────────────────────────────────────────────────

setup:
	@bash scripts/setup.sh

dev-node:
	@bash scripts/dev-node.sh

dev-node2:
	@bash scripts/dev-node2.sh

install: app-install

# ── Build ──────────────────────────────────────────────────────────────────────

logic-build:
	cd logic && ./build.sh

app-install:
	cd app && pnpm install

app-build: app-install
	cd app && pnpm build

build: logic-build app-build

# ── Dev ────────────────────────────────────────────────────────────────────────

dev: app-install
	cd app && pnpm dev

start: app-install
	@bash scripts/dev-node.sh
	@bash scripts/dev-node2.sh
	@bash scripts/dev-invite.sh
	cd app && pnpm dev

# ── Quality ────────────────────────────────────────────────────────────────────

app-typecheck:
	cd app && pnpm exec tsc --noEmit

app-lint:
	cd app && pnpm lint

# ── Test ───────────────────────────────────────────────────────────────────────

unit:
	cd app && pnpm test

e2e:
	cd app && pnpm exec playwright test

test: unit e2e

WORKFLOW_FILES := \
	workflows/e2e.yml \
	workflows/integration-setup.yml

workflows: logic-build
	@bash scripts/workflows.sh $(WORKFLOW_FILES)

workflows-no-build:
	@bash scripts/workflows.sh $(WORKFLOW_FILES)

# ── Stop dev nodes ─────────────────────────────────────────────────────────────

stop:
	@bash scripts/dev-node.sh --clean 2>/dev/null || true
	@bash scripts/dev-node2.sh --clean 2>/dev/null || true
	@-pkill -f 'merod --node merodesign-dev'   2>/dev/null || true
	@-pkill -f 'merod --node merodesign-dev-2' 2>/dev/null || true
	@for p in 2430 2431 2530 2531; do \
	  for proto in tcp udp; do \
	    pids=$$(lsof -ti $$proto:$$p 2>/dev/null); \
	    [ -n "$$pids" ] && { echo "  killing pid(s) on $$proto:$$p: $$pids"; kill -9 $$pids 2>/dev/null || true; } || true; \
	  done; \
	done
	@rm -f /tmp/merodesign-dev-node.pid /tmp/merodesign-dev-node2.pid \
	       /tmp/merodesign-dev-node.log /tmp/merodesign-dev-node2.log
	@printf '\033[32m  ✓  dev nodes stopped & cleaned\033[0m\n'

# ── Clean ──────────────────────────────────────────────────────────────────────

clean:
	cd logic && rm -rf res target
	cd app && rm -rf dist dev-dist e2e-report playwright-report test-results
