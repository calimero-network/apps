.PHONY: help install build dev test unit e2e logic-build app-install app-build app-typecheck app-lint clean run-all

# ── Help ───────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  Mero Chat — available targets"
	@echo ""
	@echo "  Setup"
	@echo "    install        Install frontend dependencies (pnpm)"
	@echo ""
	@echo "  Build"
	@echo "    build          Build Rust WASM logic + frontend"
	@echo "    logic-build    Compile logic/src → logic/res/mero_chat.wasm"
	@echo "    app-build      Bundle frontend (dist/)"
	@echo ""
	@echo "  Dev"
	@echo "    dev            Start Vite dev server (http://localhost:5173)"
	@echo ""
	@echo "  Quality"
	@echo "    app-typecheck  Run tsc --noEmit on frontend"
	@echo "    app-lint       Run ESLint on frontend"
	@echo ""
	@echo "  Test"
	@echo "    run-all        typecheck + unit + all playwright (needs 'make start' first)"
	@echo "    test           Run unit tests + e2e tests"
	@echo "    unit           Vitest unit tests"
	@echo "    e2e            Playwright e2e tests"
	@echo ""
	@echo "  Other"
	@echo "    clean          Remove all build artifacts"
	@echo ""

# ── Setup ──────────────────────────────────────────────────────────────────────

install: app-install

# ── Build ──────────────────────────────────────────────────────────────────────

logic-build:
	cd logic && cargo mero build

app-install:
	cd app && pnpm install

app-build: app-install
	cd app && pnpm build

build: logic-build app-build

# ── Dev ────────────────────────────────────────────────────────────────────────

dev: app-install
	cd app && pnpm dev

# ── Quality ────────────────────────────────────────────────────────────────────

app-typecheck:
	cd app && pnpm exec tsc --noEmit

app-lint:
	cd app && pnpm lint

# ── Test ───────────────────────────────────────────────────────────────────────

# Run everything locally — requires nodes already running via 'make start'.
# Order: typecheck → unit (Vitest) → rpc/rpc-admin (headless, no Vite) → mocked (Playwright starts Vite)
run-all: app-install
	@echo ""
	@printf '\033[1;36m▶  typecheck\033[0m\n'
	cd app && pnpm exec tsc --noEmit
	@echo ""
	@printf '\033[1;36m▶  unit tests (Vitest)\033[0m\n'
	cd app && pnpm test
	@echo ""
	@printf '\033[1;36m▶  RPC + admin tests (Playwright — needs running nodes)\033[0m\n'
	cd app && SKIP_DEV_SERVER=1 pnpm exec playwright test --project=rpc --project=rpc-admin
	@echo ""
	@printf '\033[1;36m▶  mocked browser tests (Playwright)\033[0m\n'
	cd app && pnpm exec playwright test --project=mocked
	@echo ""
	@printf '\033[1;32m══════════════════════════════\033[0m\n'
	@printf '\033[1;32m  All checks passed\033[0m\n'
	@printf '\033[1;32m══════════════════════════════\033[0m\n'

unit:
	cd app && pnpm test

e2e:
	cd app && pnpm exec playwright test

test: unit e2e

WORKFLOW_FILES := \
	workflows/e2e.yml \
	workflows/e2e-v2.yml \
	workflows/integration-setup.yml \
	workflows/dm.yml

# ── Stop dev nodes ─────────────────────────────────────────────────────────────

# ── Clean ──────────────────────────────────────────────────────────────────────

clean:
	cd logic && rm -rf res target
	cd app && rm -rf dist e2e-report playwright-report test-results
