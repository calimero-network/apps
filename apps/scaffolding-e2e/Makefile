.PHONY: ci ci-rust ci-server ci-frontend help

# Run all CI checks that can be validated locally (mirrors GitHub Actions).
# Usage: make ci
ci: ci-rust ci-server ci-frontend
	@echo ""
	@echo "All CI checks passed."

# ── Rust (logic/) — mirrors rust-lint.yml ─────────────────────────────────────

ci-rust:
	@echo "==> [rust] cargo fmt --check"
	cd logic && cargo fmt --check
	@echo "==> [rust] cargo clippy"
	cd logic && cargo clippy --target wasm32-unknown-unknown -- -D warnings

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

# ── Frontend (frontend/) — mirrors frontend-playwright.yml ───────────────────
# Requires: pnpm install already run and a dev server available.
# Runs only the mocked UI tests (no live node needed).

ci-frontend:
	@echo "==> [frontend] pnpm install"
	cd frontend && pnpm install
	@echo "==> [frontend] tsc --noEmit"
	cd frontend && pnpm exec tsc --noEmit
	@echo "==> [frontend] playwright (mocked)"
	cd frontend && pnpm exec playwright test --config=playwright.mocked.config.ts

help:
	@echo "Targets:"
	@echo "  make ci            — run all local CI checks"
	@echo "  make ci-rust       — cargo fmt + clippy (logic/)"
	@echo "  make ci-server     — prettier + eslint + tests (sync-test-server/)"
	@echo "  make ci-frontend   — tsc + playwright mocked tests (frontend/)"
