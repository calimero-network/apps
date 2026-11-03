.PHONY: help dev e2e logic-test logic-lint logic-build logic-bundle app-test app-lint app-typecheck app-build clean

# Run from the repo root's tools; every target works from this directory.
ROOT := ../..
LOGIC := logic
BUNDLER := cargo run --release --manifest-path $(ROOT)/tools/component-bundle/Cargo.toml --

help:
	@echo ""
	@echo "  Mero Stream — streaming media OVER Calimero (Task 3 capacity probe)"
	@echo "  A component app: docs/COMPONENT-APPS.md at the repo root."
	@echo ""
	@echo "  dev            merod local + build + deploy + the app on http://localhost:5173/"
	@echo "  e2e            every logic/scenarios/*.json on merod local"
	@echo "  logic-test     the contract on core's wasmtime engine (TestApp + scenarios)"
	@echo "  logic-lint     cargo fmt --check, clippy on the host and wasm32-wasip2"
	@echo "  logic-build    logic/res/mero_stream.wasm + logic/res/abi.json"
	@echo "  logic-bundle   a dev-signed .mpk (never publishable)"
	@echo "  app-test       frontend unit tests (vitest)"
	@echo "  app-lint       eslint"
	@echo "  app-typecheck  tsc -b"
	@echo "  app-build      the production frontend (app/dist)"
	@echo ""

dev:
	cd $(ROOT) && pnpm dev:local mero-stream

e2e:
	cd $(ROOT) && pnpm merod-local e2e mero-stream

logic-test:
	cargo test --manifest-path $(LOGIC)/Cargo.toml

logic-lint:
	cargo fmt --manifest-path $(LOGIC)/Cargo.toml -- --check
	cargo clippy --manifest-path $(LOGIC)/Cargo.toml --all-targets -- -D warnings
	cargo clippy --manifest-path $(LOGIC)/Cargo.toml --target wasm32-wasip2 -- -D warnings

logic-build:
	$(BUNDLER) build $(LOGIC)

logic-bundle: logic-build
	$(BUNDLER) bundle $(LOGIC) --dev

app-test:
	pnpm -F mero-stream test

app-lint:
	pnpm -F mero-stream lint

# `tsc -b`, NOT `tsc --noEmit`: app/tsconfig.json is a solution file, and
# `--noEmit` on it checks nothing and exits 0.
app-typecheck:
	pnpm -F mero-stream typecheck

app-build:
	pnpm -F mero-stream build

clean:
	rm -rf $(LOGIC)/target $(LOGIC)/dist app/dist app/dist-types
