.PHONY: setup dev dev-local build unit test typecheck lint logic-build logic-test e2e bundle clean

ROOT := ../..
MC := cargo run --release --manifest-path $(ROOT)/tools/component-bundle/Cargo.toml --

setup: ## install frontend deps (the pnpm workspace)
	cd $(ROOT) && pnpm install

dev-local: ## merod local + build + deploy + the dev server on http://localhost:5173
	cd $(ROOT) && pnpm dev:local mero-blocks

dev: ## the dev server alone, against a cluster `pnpm merod-local deploy mero-blocks` set up
	cd app && pnpm dev

build: logic-build ## component + frontend
	cd app && pnpm build

unit: ## frontend unit tests (vitest)
	cd app && pnpm test

typecheck:
	cd app && pnpm typecheck

lint:
	cd app && pnpm lint

logic-build: ## the component -> logic/res/mero_blocks.wasm (+ res/abi.json)
	$(MC) build logic

logic-test: ## the TestApp harness + scenarios on core's wasmtime engine
	cd logic && cargo test

e2e: ## every logic/scenarios/*.json on merod local (needs merod at component-core-tag)
	cd $(ROOT) && pnpm merod-local e2e mero-blocks

test: unit logic-test

bundle: ## dev-signed .mpk (never publishable) -> logic/dist/
	cd app && pnpm build
	$(MC) bundle logic --dev

clean:
	rm -rf logic/res/*.wasm logic/target logic/dist app/dist app/node_modules/.vite
