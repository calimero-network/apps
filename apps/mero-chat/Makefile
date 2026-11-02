# Mero Chat: the contract (logic/) and the frontend (app/), on Calimero 1.0.
# Run from the repository root's tools; see README.md.
ROOT := $(abspath ../..)
M    := $(ROOT)/tools/component-bundle/Cargo.toml

.PHONY: help dev logic-build logic-test e2e app-install app-build app-check bundle

help:
	@echo "  dev          merod local + build + deploy + the app on http://localhost:5173/"
	@echo "  logic-build  logic/res/mero_chat.wasm + logic/res/abi.json"
	@echo "  logic-test   cargo test: search unit tests, TestApp harness, scenarios"
	@echo "  e2e          the scenarios as real accounts on merod local"
	@echo "  app-check    frontend lint, typecheck, test, build"
	@echo "  bundle       a dev-signed dist/com.calimero.chat-*.mpk with the built frontend"

dev:
	cd $(ROOT) && pnpm dev:local mero-chat

logic-build:
	cargo run --release --manifest-path $(M) -- build $(CURDIR)/logic

logic-test:
	cargo test --manifest-path logic/Cargo.toml

e2e:
	cd $(ROOT) && pnpm merod-local e2e mero-chat

app-install:
	cd $(ROOT) && pnpm install

app-build:
	cd $(ROOT) && pnpm -F mero-chat build

app-check:
	cd $(ROOT) && pnpm -F mero-chat lint && pnpm -F mero-chat typecheck && pnpm -F mero-chat test && pnpm -F mero-chat build

bundle: app-build
	cargo run --release --manifest-path $(M) -- bundle $(CURDIR)/logic --dev
