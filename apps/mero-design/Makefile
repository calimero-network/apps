.PHONY: help dev logic-build logic-test logic-bundle app-install app-build app-typecheck app-lint unit e2e test clean

# Run from the repo root's tools; see README.md and docs/COMPONENT-APPS.md.
ROOT := ../..
# core's `meroctl` (scripts/install-meroctl.sh) builds and packs the component.
BUILD := $(ROOT)/scripts/component-build.sh

help:
	@echo ""
	@echo "  MeroDesign — available targets"
	@echo ""
	@echo "    dev            merod local + the contract + the app on http://localhost:5173/"
	@echo "    logic-build    Build the component and write logic/res/abi.json"
	@echo "    logic-test     cargo test: the harness and every scenario"
	@echo "    logic-bundle   A dev-signed .mpk with the built frontend"
	@echo "    app-build      Bundle the frontend (app/dist)"
	@echo "    app-typecheck  tsc"
	@echo "    app-lint       ESLint"
	@echo "    unit           Vitest unit tests"
	@echo "    e2e            The scenarios on merod local"
	@echo "    test           logic-test + unit"
	@echo "    clean          Remove build artifacts"
	@echo ""

dev:
	cd $(ROOT) && pnpm dev:local mero-design

logic-build:
	$(BUILD) logic

logic-test:
	cargo test --manifest-path logic/Cargo.toml

logic-bundle: app-build
	wasm=$$($(BUILD) logic) && meroctl app pack logic --wasm "$$wasm"

app-install:
	cd $(ROOT) && pnpm install

app-build:
	cd app && pnpm build

app-typecheck:
	cd app && pnpm typecheck

app-lint:
	cd app && pnpm lint

unit:
	cd app && pnpm test

e2e:
	cd $(ROOT) && pnpm merod-local e2e mero-design

test: logic-test unit

clean:
	cd logic && rm -rf res/*.wasm target
	cd app && rm -rf dist
