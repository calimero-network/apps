.PHONY: ci ci-rust ci-wasm ci-server ci-frontend help

# Run all fast CI checks (mirrors GitHub Actions, no Docker).
# Usage: make ci
ci: ci-rust ci-wasm ci-server ci-frontend
	@echo ""
	@echo "All fast CI checks passed."

# ── Rust (logic/) — mirrors rust-lint.yml ─────────────────────────────────────

ci-rust:
	@echo "==> [rust] cargo fmt --check"
	cd logic && cargo fmt --check
	@echo "==> [rust] cargo clippy"
	cd logic && cargo clippy --target wasm32-unknown-unknown -- -D warnings

# ── WASM build (logic/) — mirrors build-wasm in e2e-merobox.yml + frontend-playwright.yml
# Produces logic/res/scaffolding_e2e.wasm which the frontend and merobox both consume.

ci-wasm:
	@echo "==> [wasm] logic/build.sh"
	cd logic && ./build.sh
	@echo "==> [wasm] bundle freshness"
	./logic/check-bundle-fresh.sh

# ── Server (sync-test-server/) — mirrors server-tests-lint.yml ───────────────

ci-server:
	@echo "==> [server] npm install"
	cd sync-test-server && npm ci
	@echo "==> [server] prettier --check"
	cd sync-test-server && npx prettier --check .
	@echo "==> [server] eslint"
	cd sync-test-server && npx eslint .
	@echo "==> [server] npm test"
	cd sync-test-server && npm test

# ── Frontend (app/) — mirrors frontend-playwright.yml ───────────────────
# Depends on ci-wasm so public/app.wasm exists before Playwright runs.

ci-frontend: ci-wasm
	@echo "==> [frontend] pnpm install"
	cd app && pnpm install --frozen-lockfile
	@echo "==> [frontend] tsc --noEmit"
	cd app && pnpm exec tsc -b --noEmit
	@echo "==> [frontend] sync-wasm"
	cd app && pnpm sync-wasm
	@echo "==> [frontend] write .env if missing"
	cd app && [ -f .env ] || (echo "VITE_NODE_URL=http://localhost:2528" > .env && echo "VITE_APPLICATION_PACKAGE=com.calimero.scaffolding-e2e" >> .env)
	@echo "==> [frontend] playwright install (chromium)"
	cd app && pnpm exec playwright install chromium
	@echo "==> [frontend] playwright (mocked)"
	cd app && pnpm exec playwright test --config=playwright.mocked.config.ts

# ── Merobox E2E (logic/workflows/) — mirrors e2e-merobox.yml ─────────────────
# Runs every workflow YAML against a 3-node Docker mesh. Requires Docker.

help:
	@echo "Targets:"
	@echo "  make ci            — fast CI checks: rust + wasm + server + frontend (no Docker)"
	@echo "  make ci-rust       — cargo fmt + clippy (logic/)"
	@echo "  make ci-wasm       — build logic/res/scaffolding_e2e.wasm"
	@echo "  make ci-server     — prettier + eslint + tests (sync-test-server/)"
	@echo "  make ci-frontend   — tsc + Playwright mocked tests (depends on ci-wasm)"
