.PHONY: ci ci-all ci-rust ci-wasm ci-server ci-frontend ci-merobox clean-merobox help

# Run all fast CI checks (mirrors GitHub Actions, no Docker).
# Usage: make ci
ci: ci-rust ci-wasm ci-server ci-frontend
	@echo ""
	@echo "All fast CI checks passed."

# Run everything including merobox E2E workflows (slow, requires Docker).
# Usage: make ci-all
ci-all: ci ci-merobox
	@echo ""
	@echo "All CI checks (including merobox E2E) passed."

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
# Depends on ci-wasm so public/app.wasm exists before Playwright runs.

ci-frontend: ci-wasm
	@echo "==> [frontend] pnpm install"
	cd frontend && pnpm install --frozen-lockfile
	@echo "==> [frontend] tsc --noEmit"
	cd frontend && pnpm exec tsc -b --noEmit
	@echo "==> [frontend] sync-wasm"
	cd frontend && pnpm sync-wasm
	@echo "==> [frontend] write .env if missing"
	cd frontend && [ -f .env ] || (echo "VITE_NODE_URL=http://localhost:2528" > .env && echo "VITE_APPLICATION_PACKAGE=com.calimero.scaffolding-e2e" >> .env)
	@echo "==> [frontend] playwright install (chromium)"
	cd frontend && pnpm exec playwright install chromium
	@echo "==> [frontend] playwright (mocked)"
	cd frontend && pnpm exec playwright test --config=playwright.mocked.config.ts

# ── Merobox E2E (logic/workflows/) — mirrors e2e-merobox.yml ─────────────────
# Runs every workflow YAML against a 3-node Docker mesh. Requires Docker.

ci-merobox: ci-wasm
	@echo "==> [merobox] docker pull merod:0.11.0-rc.28"
	docker pull ghcr.io/calimero-network/merod:0.11.0-rc.28
	@echo "==> [merobox] running all workflows"
	@cd logic && set -e; \
	failed=""; \
	for wf in workflows/*.yml; do \
		echo ""; \
		echo "── $$wf ──"; \
		if ! merobox bootstrap run "$$wf" --e2e-mode; then \
			failed="$$failed $$wf"; \
		fi; \
		merobox stop --all >/dev/null 2>&1 || true; \
		merobox nuke --force >/dev/null 2>&1 || true; \
		sudo rm -rf data || true; \
	done; \
	if [ -n "$$failed" ]; then \
		echo ""; \
		echo "FAILED workflows:$$failed"; \
		exit 1; \
	fi

clean-merobox:
	@echo "==> [merobox] cleanup"
	-merobox stop --all
	-merobox nuke --force
	-sudo rm -rf logic/data

help:
	@echo "Targets:"
	@echo "  make ci            — fast CI checks: rust + wasm + server + frontend (no Docker)"
	@echo "  make ci-all        — everything including merobox E2E (slow, requires Docker)"
	@echo "  make ci-rust       — cargo fmt + clippy (logic/)"
	@echo "  make ci-wasm       — build logic/res/scaffolding_e2e.wasm"
	@echo "  make ci-server     — prettier + eslint + tests (sync-test-server/)"
	@echo "  make ci-frontend   — tsc + Playwright mocked tests (depends on ci-wasm)"
	@echo "  make ci-merobox    — run every logic/workflows/*.yml against merod:edge"
	@echo "  make clean-merobox — stop containers, nuke state, remove logic/data"
