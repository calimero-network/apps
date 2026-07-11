.PHONY: setup build dev unit e2e test typecheck logic-build logic-test clean workflows

setup: ## install frontend deps
	cd app && pnpm install

dev: ## run the game locally (offline mode works with no node)
	cd app && pnpm dev

build: logic-build ## build wasm + frontend
	cd app && pnpm build

unit: ## frontend unit tests (vitest)
	cd app && pnpm test

e2e: ## mocked end-to-end tests (playwright)
	cd app && pnpm e2e

typecheck:
	cd app && pnpm typecheck

logic-build: ## build the WASM contract -> logic/res/mero_blocks.wasm
	cd logic && ./build.sh

logic-test: ## contract unit tests on the native mock host
	cd logic && cargo test

test: unit logic-test

clean:
	rm -rf logic/res logic/target app/dist app/node_modules/.vite app/test-results

workflows: logic-build ## 2-node merobox e2e (needs docker)
	cd workflows && merobox bootstrap run e2e.yml; merobox stop --all || true
