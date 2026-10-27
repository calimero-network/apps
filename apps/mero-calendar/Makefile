.PHONY: help setup install build bundle bundle-release publish restart frontend logic-build logic-bundle logic-test-rust app-install app-build app-typecheck app-lint test unit e2e e2e-ui integration clean

# ── Help ───────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  Mero Calendar — available targets"
	@echo ""
	@echo "  Setup"
	@echo "    setup          Build logic, install app deps"
	@echo "    install        Install frontend dependencies (pnpm)"
	@echo ""
	@echo "  Build"
	@echo "    build          Build Rust WASM logic + frontend"
	@echo "    logic-build    Compile logic/src → logic/res/mero_calendar.wasm (+ abi.json)"
	@echo "    bundle         Dev-signed .mpk for local installs (logic/dist/)"
	@echo "    bundle-release Publishable .mpk signed with \$$MERO_SIGN_KEY_FILE"
	@echo "    publish        Push a built .mpk to the Calimero App Registry"
	@echo "    app-build      Bundle frontend (dist/)"
	@echo ""
	@echo "  Dev"
	@echo "    frontend       Frontend only (http://localhost:5174)"
	@echo ""
	@echo "  Test"
	@echo "    test           Unit + e2e (mocked) tests"
	@echo "    unit           Vitest unit tests"
	@echo "    e2e            Playwright mocked e2e tests"
	@echo "    integration    Playwright integration tests (needs a running node)"
	@echo "    logic-test-rust  Rust unit tests (cargo test)"
	@echo ""
	@echo "    clean          Remove all build artifacts"
	@echo ""

# ── Setup ──────────────────────────────────────────────────────────────────────

setup: logic-build app-install

install: app-install

# ── Build ──────────────────────────────────────────────────────────────────────

# `cargo mero build` (core #3374) replaced the per-app build.sh: it drives cargo,
# wasm-opt and the copy into res/, and additionally emits res/abi.json +
# res/state-schema.json and embeds the ABI in the wasm — which the old script
# could not do at all. Install it with:
#   cargo install --git https://github.com/calimero-network/core --tag 0.12.0-rc.1 cargo-mero
# and keep the tag equal to logic/Cargo.toml's calimero-sdk tag: the ABI emitter
# is versioned with core.
logic-build:
	cd logic && cargo mero build

# Every manifest field now comes from [package.metadata.calimero] in
# logic/Cargo.toml, so there is no manifest heredoc to keep in sync any more.
logic-bundle:
	cd logic && cargo mero bundle --dev

bundle: logic-bundle

# --bump patch asks the registry for the highest published appVersion and
# increments it, which is what the deleted build-bundle.sh's curl|python3
# version resolver used to do by hand.
bundle-release:
	cd logic && cargo mero bundle --key "$$MERO_SIGN_KEY_FILE" --bump patch

publish:
	cd logic && cargo mero publish dist/com.calimero.mero-calendar-*.mpk

logic-test-rust:
	cd logic && cargo test

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
	cd app && pnpm exec playwright test --project=mocked

e2e-ui:
	cd app && pnpm exec playwright test --ui --project=mocked

integration:
	cd app && pnpm exec playwright test --project=integration

test: unit e2e

WORKFLOW_FILES := \
	logic/workflows/e2e.yml \
	logic/workflows/integration-setup.yml

LOGIC_TEST_FILES := \
	logic/workflows/logic-test.yml

# ── Stop dev nodes ─────────────────────────────────────────────────────────────

# ── Clean ──────────────────────────────────────────────────────────────────

clean:
	cd logic && rm -rf res dist target
	cd app && rm -rf dist dev-dist build e2e-report playwright-report test-results
