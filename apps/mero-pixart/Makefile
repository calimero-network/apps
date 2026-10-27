.PHONY: help install build bundle frontend logic-build logic-bundle app-install app-build app-typecheck app-lint test unit e2e e2e-ui clean

# ── Help ───────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  MeroPixArt — available targets"
	@echo ""
	@echo "  Setup"
	@echo "    install        Install frontend dependencies (pnpm)"
	@echo ""
	@echo "  Build"
	@echo "    build          Build Rust WASM logic + frontend"
	@echo "    logic-build    Compile logic/src → logic/res/mero_pixart.wasm"
	@echo "    bundle         Build WASM + create .mpk release bundle"
	@echo "    app-build      Bundle frontend (dist/)"
	@echo ""
	@echo "  Dev"
	@echo "    frontend       Frontend only (http://localhost:5176)"
	@echo ""
	@echo "  Quality"
	@echo "    app-typecheck  Run tsc --noEmit"
	@echo "    app-lint       Run ESLint"
	@echo ""
	@echo "  Test"
	@echo "    test           Unit + e2e tests"
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

# The manifest's `icon` (logic/Cargo.toml) is embedded as a data: URI, so the
# bundle carries its own mark — deterministic and offline, unlike letting the
# desktop scrape the frontend's PWA manifest. Regenerate the PNGs it points at
# with `node app/scripts/gen-icons.mjs`.
logic-bundle:
	cd logic && cargo mero bundle --dev

logic-bundle-release: ## publishable .mpk signed with $$MERO_SIGN_KEY_FILE, version bumped off the registry
	cd logic && cargo mero bundle --key "$$MERO_SIGN_KEY_FILE" --bump patch

bundle: logic-bundle

app-install:
	cd app && pnpm install

app-build: app-install
	cd app && pnpm build

build: logic-build app-build

# ── Dev ────────────────────────────────────────────────────────────────────────

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
	cd app && pnpm exec playwright test

test: unit e2e

e2e-ui:
	cd app && pnpm exec playwright test --ui --project=mocked

WORKFLOW_FILES := \
	workflows/e2e.yml \
	workflows/integration-setup.yml

LOGIC_TEST_FILES := \
	workflows/logic-test.yml

# ── Stop dev nodes ─────────────────────────────────────────────────────────────

# ── Clean ──────────────────────────────────────────────────────────────────────

clean:
	cd logic && rm -rf res target
	cd app && rm -rf dist dev-dist e2e-report playwright-report test-results
