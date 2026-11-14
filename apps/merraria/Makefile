.PHONY: setup dev build unit typecheck lint logic-build logic-test test bundle e2e clean

ROOT := ../..
# core's `meroctl` (scripts/install-meroctl.sh) builds and packs the component.
BUILD := $(ROOT)/scripts/component-build.sh

setup: ## pnpm install at the repo root + the wasm target
	cd $(ROOT) && pnpm install
	rustup target add wasm32-wasip2

dev: ## merod local + build + deploy + the game on http://localhost:5173/
	cd $(ROOT) && pnpm dev:local merraria

build: logic-build ## the component + the frontend
	cd app && pnpm build

unit: ## frontend unit tests (vitest)
	cd app && pnpm test

typecheck:
	cd app && pnpm typecheck

lint:
	cd app && pnpm lint

logic-build: ## the component -> logic/res/merraria.wasm (+ res/abi.json)
	$(BUILD) logic

logic-test: ## the component on core's wasmtime engine (TestApp) + scenarios/*.json
	cargo test --manifest-path logic/Cargo.toml

test: unit logic-test

e2e: ## every scenarios/*.json on merod local (needs merod; starts a fresh cluster if none runs)
	cd $(ROOT) && pnpm merod-local e2e merraria

bundle: ## dev-signed .mpk for merod local -> dist/com.calimero.merraria-<ver>.mpk
	wasm=$$($(BUILD) logic) && meroctl app pack logic --wasm "$$wasm"

clean:
	rm -rf logic/res/*.wasm logic/target app/dist app/node_modules/.vite
