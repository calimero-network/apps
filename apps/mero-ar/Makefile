.PHONY: help setup tools logic-build logic-bundle logic-test \
        app-gen app-build app-test test clean

APP_DIR    := app/MeroAR
XCODEPROJ  := $(APP_DIR)/MeroAR.xcodeproj
SCHEME     := MeroAR
SIMULATOR  ?= iPhone 17

# ── Help ─────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  Mero AR — make targets"
	@echo ""
	@echo "  Setup"
	@echo "    setup        Check prereqs, install mero-component, bundle the contract"
	@echo "    tools        Install mero-component (calimero-network/apps' component bundler)"
	@echo ""
	@echo "  Contract (Rust, a calimero:app component)"
	@echo "    logic-build  Build logic/ → logic/res/mero_ar.wasm + logic/res/abi.json"
	@echo "    logic-bundle Package the dev-signed .mpk a merod local cluster accepts"
	@echo "    logic-test   cargo test (pure helpers + the TestApp harness on core's engine)"
	@echo ""
	@echo "  iOS app (needs full Xcode + 'brew install xcodegen')"
	@echo "    app-gen      Generate MeroAR.xcodeproj from project.yml"
	@echo "    app-build    Build the app for a generic iOS device (unsigned)"
	@echo "    app-test     Run the unit tests (SIMULATOR=… to pick a device)"
	@echo ""
	@echo "  Aggregate"
	@echo "    test         logic-test + app-test"
	@echo "    clean        Remove build artifacts"
	@echo ""

# ── Setup ─────────────────────────────────────────────────────────────────────
setup:
	@bash scripts/setup.sh

# `mero-component` builds the contract into a `calimero:app` component and packs
# the signed .mpk, with core's own builder, bundle format and signer. It is the
# apps repo's tool (tools/component-bundle); `cargo mero` went with SDK 0.12.
APPS_REF ?= main

tools:
	cargo install --locked --git https://github.com/calimero-network/apps --branch $(APPS_REF) mero-component

# ── Contract ───────────────────────────────────────────────────────────────────
logic-build:
	mero-component build logic

# What a development cluster installs (`meroctl app install --path`; dev only).
# `--dev` signs with the well-known development key, which the registry refuses
# by design; `--app-version` is a placeholder because
# the registry owns the published number (see logic/Cargo.toml).
logic-bundle:
	mero-component bundle logic --dev --no-frontend --app-version 0.0.0 --output logic/res/mero-ar.mpk

logic-test:
	cd logic && cargo test

# ── iOS app ─────────────────────────────────────────────────────────────────────
app-gen:
	@command -v xcodegen >/dev/null 2>&1 || { echo "xcodegen not found — run: brew install xcodegen"; exit 1; }
	cd $(APP_DIR) && xcodegen generate

app-build: app-gen
	xcodebuild -project $(XCODEPROJ) -scheme $(SCHEME) \
	  -destination 'generic/platform=iOS' \
	  -derivedDataPath $(APP_DIR)/.build build CODE_SIGNING_ALLOWED=NO

app-test: app-gen
	xcodebuild -project $(XCODEPROJ) -scheme $(SCHEME) \
	  -destination 'platform=iOS Simulator,name=$(SIMULATOR)' \
	  -derivedDataPath $(APP_DIR)/.build test -only-testing:MeroARTests

# ── Aggregate ──────────────────────────────────────────────────────────────────
# The Swift client itself is the shared SDK (calimero-network/swift-sdk, declared
# in app/MeroAR/project.yml) and is tested in its own repo; what this repo tests
# is the contract plus this app against that SDK.
test: logic-test app-test

clean:
	cd logic && rm -rf res target
	rm -rf $(APP_DIR)/.build $(XCODEPROJ)
