.PHONY: help setup install build dev dev-node dev-node2 start test test-all test-full unit e2e workflows ci ci-stop \
        logic-build app-install app-build app-typecheck app-lint clean

# ── Help ───────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  Mero Chat — available targets"
	@echo ""
	@echo "  Setup"
	@echo "    setup          Check prereqs, build logic, install app deps"
	@echo "    dev-node       Start node1 with full workspace setup"
	@echo "    dev-node2      Start node2 only (no workspace — invite from webapp)"
	@echo "    install        Install frontend dependencies (pnpm)"
	@echo ""
	@echo "  Build"
	@echo "    build          Build Rust WASM logic + frontend"
	@echo "    logic-build    Compile logic/src → logic/res/curb.wasm"
	@echo "    app-build      Bundle frontend (dist/)"
	@echo ""
	@echo "  Dev"
	@echo "    start          Node1 (full setup) + node2 (auto-invited) + frontend"
	@echo "    dev            Start Vite dev server (http://localhost:5173)"
	@echo ""
	@echo "  Quality"
	@echo "    app-typecheck  Run tsc --noEmit on frontend"
	@echo "    app-lint       Run ESLint on frontend"
	@echo ""
	@echo "  Test"
	@echo "    test-all       Full pipeline: build + ci + workflows, with pass/fail summary"
	@echo "    test-full      1 node: rpc + rpc-admin + mocked + live (58 tests, skips 2-node)"
	@echo "    ci             2 nodes: rpc + rpc-admin + mocked — full suite (90 tests)"
	@echo "    test           Run unit tests + e2e tests"
	@echo "    unit           Vitest unit tests"
	@echo "    e2e            Playwright e2e tests"
	@echo "    ci-stop        Stop nodes started by 'make ci' or setup-nodes.sh"
	@echo "    workflows      merobox workflow tests (e2e + dm + integration-setup)"
	@echo "    integration-shell  curl-direct integration driver (requires running nodes)"
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

# Full dev setup: node1 (full setup) + node2 (auto-invited into node1's workspace) + frontend.
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

# Start a single dev node, run all test suites, stop node on exit.
# Projects:
#   rpc + rpc-admin  — headless HTTP/RPC tests (no browser, no Vite)
#   mocked           — browser tests with mock API (Playwright starts Vite)
#   live             — browser tests with real auth injected from .env.integration
test-full: app-install
	@REPO_ROOT="$$(pwd)"; \
	bash scripts/dev-node.sh; \
	trap "bash $$REPO_ROOT/scripts/dev-node.sh --stop 2>/dev/null || true" EXIT; \
	cd app && \
	  SKIP_DEV_SERVER=1 pnpm exec playwright test --project=rpc --project=rpc-admin && \
	  pnpm exec playwright test --project=mocked && \
	  LIVE_AUTH=1 pnpm exec playwright test --project=live

unit:
	cd app && pnpm test

e2e:
	cd app && pnpm exec playwright test

test: unit e2e

# End-to-end validation: build + ci + workflows, with per-phase pass/fail
# reporting and log paths for any failures. Skips `make start` because it
# ends in `pnpm dev` and never exits. Use this before tagging a release.
test-all:
	@bash scripts/test-all.sh

# Build WASM, spin up 2 nodes, run all RPC+admin tests, tear down.
# Nodes are stopped even if tests fail (trap EXIT in ci.sh).
ci:
	@NODE_1_P2P_PORT=$${NODE_1_P2P_PORT:-3628} NODE_2_P2P_PORT=$${NODE_2_P2P_PORT:-3629} bash scripts/ci.sh

ci-no-build:
	@NODE_1_P2P_PORT=$${NODE_1_P2P_PORT:-3628} NODE_2_P2P_PORT=$${NODE_2_P2P_PORT:-3629} bash scripts/ci.sh --no-build

ci-stop:
	@bash scripts/setup-nodes.sh --stop

WORKFLOW_FILES := \
	workflows/e2e.yml \
	workflows/e2e-v2.yml \
	workflows/integration-setup.yml \
	workflows/dm.yml

workflows: logic-build
	@bash scripts/workflows.sh $(WORKFLOW_FILES)

# Shell-based integration driver. Complements merobox by exposing real
# admin-API error messages that merobox swallows. Requires both nodes
# already running (start with `make ci-no-build` or `setup-nodes.sh`).
integration-shell:
	@bash scripts/integration-test.sh

# ── Stop dev nodes ─────────────────────────────────────────────────────────────

# Kill both dev nodes, free their ports (admin: 2428/2429, p2p: 2528/2529),
# and delete their home directories + tmp pid/log files. Idempotent.
stop:
	@bash scripts/dev-node.sh --clean 2>/dev/null || true
	@bash scripts/dev-node2.sh --clean 2>/dev/null || true
	@-pkill -f 'merod --node curb-dev'   2>/dev/null || true
	@-pkill -f 'merod --node curb-dev-2' 2>/dev/null || true
	@for p in 2428 2429 2528 2529; do \
	  for proto in tcp udp; do \
	    pids=$$(lsof -ti $$proto:$$p 2>/dev/null); \
	    [ -n "$$pids" ] && { echo "  killing pid(s) on $$proto:$$p: $$pids"; kill -9 $$pids 2>/dev/null || true; } || true; \
	  done; \
	done
	@rm -f /tmp/curb-dev-node.pid /tmp/curb-dev-node2.pid \
	       /tmp/curb-dev-node.log /tmp/curb-dev-node2.log
	@printf '\033[32m  ✓  dev nodes stopped & cleaned\033[0m\n'

# ── Clean ──────────────────────────────────────────────────────────────────────

clean:
	cd logic && rm -rf res target
	cd app && rm -rf dist e2e-report playwright-report test-results
