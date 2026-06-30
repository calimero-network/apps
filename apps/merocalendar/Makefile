.PHONY: help setup install build bundle dev restart frontend dev-node dev-node2 dev-invite stop \
        logic-build logic-bundle logic-test-rust app-install app-build app-typecheck app-lint \
        test unit e2e e2e-ui integration workflows workflows-no-build logic-test clean

# ── Help ───────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  Mero Calendar — available targets"
	@echo ""
	@echo "  Setup"
	@echo "    setup          Build logic, install app deps"
	@echo "    dev-node       Start node1: build WASM, init node, install app, create team calendar"
	@echo "    dev-node2      Start node2 only"
	@echo "    dev-invite     Invite node2 into node1's team (run after both nodes up)"
	@echo "    install        Install frontend dependencies (pnpm)"
	@echo ""
	@echo "  Build"
	@echo "    build          Build Rust WASM logic + frontend"
	@echo "    logic-build    Compile logic/src → logic/res/merocalendar.wasm"
	@echo "    bundle         Build WASM + create signed .mpk release bundle"
	@echo "    app-build      Bundle frontend (dist/)"
	@echo ""
	@echo "  Dev"
	@echo "    dev            Full stack: build WASM, 2 nodes, invite, frontend"
	@echo "    frontend       Frontend only (http://localhost:5174)"
	@echo "    stop           Stop all dev nodes and free ports"
	@echo ""
	@echo "  Test"
	@echo "    test           Unit + e2e (mocked) tests"
	@echo "    unit           Vitest unit tests"
	@echo "    e2e            Playwright mocked e2e tests"
	@echo "    integration    Playwright integration tests (needs a running node)"
	@echo "    logic-test     merobox single-node contract workflow"
	@echo "    workflows      merobox multi-node workflow tests"
	@echo "    logic-test-rust  Rust unit tests (cargo test)"
	@echo ""
	@echo "    clean          Remove all build artifacts"
	@echo ""

# ── Setup ──────────────────────────────────────────────────────────────────────

setup: logic-build app-install

dev-node:
	@bash scripts/dev-node.sh

dev-node2:
	@bash scripts/dev-node2.sh

dev-invite:
	@bash scripts/dev-invite.sh

install: app-install

# ── Build ──────────────────────────────────────────────────────────────────────

logic-build:
	cd logic && ./build.sh

logic-bundle:
	cd logic && ./build-bundle.sh

bundle: logic-bundle

logic-test-rust:
	cd logic && cargo test

app-install:
	cd app && pnpm install

app-build: app-install
	cd app && pnpm build

build: logic-build app-build

# ── Dev ────────────────────────────────────────────────────────────────────────

dev: app-install
	@bash scripts/dev-node.sh
	@bash scripts/dev-node2.sh
	@bash scripts/dev-invite.sh
	cd app && pnpm dev

frontend: app-install
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
	cd app && pnpm exec playwright test --project=mocked

e2e-ui:
	cd app && pnpm exec playwright test --ui --project=mocked

integration:
	cd app && pnpm exec playwright test --project=integration

test: unit e2e

WORKFLOW_FILES := \
	workflows/e2e.yml \
	workflows/integration-setup.yml

LOGIC_TEST_FILES := \
	workflows/logic-test.yml

workflows: logic-build
	@bash scripts/workflows.sh $(WORKFLOW_FILES)

workflows-no-build:
	@bash scripts/workflows.sh $(WORKFLOW_FILES)

logic-test: logic-build
	@bash scripts/workflows.sh $(LOGIC_TEST_FILES)

# ── Stop dev nodes ─────────────────────────────────────────────────────────────

stop:
	@-pkill -f 'merod --node merocalendar-dev'   2>/dev/null || true
	@-pkill -f 'merod --node merocalendar-dev-2' 2>/dev/null || true
	@for p in 2470 2471 2570 2571; do \
	  for proto in tcp udp; do \
	    pids=$$(lsof -ti $$proto:$$p 2>/dev/null); \
	    [ -n "$$pids" ] && { echo "  killing pid(s) on $$proto:$$p: $$pids"; kill -9 $$pids 2>/dev/null || true; } || true; \
	  done; \
	done
	@rm -f /tmp/merocalendar-dev-node.pid /tmp/merocalendar-dev-node2.pid
	@printf '\033[32m  ✓  dev nodes stopped & cleaned\033[0m\n'

# ── Clean ──────────────────────────────────────────────────────────────────

clean:
	cd logic && rm -rf res target
	cd app && rm -rf dist dev-dist build e2e-report playwright-report test-results
