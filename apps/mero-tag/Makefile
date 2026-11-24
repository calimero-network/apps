.PHONY: help setup tools logic-build logic-bundle logic-test dev dev-down \
        web-build core-test app-gen app-build app-run app-test test clean

APP_DIR    := mobile/ios
XCODEPROJ  := $(APP_DIR)/MeroTag.xcodeproj
SCHEME     := MeroTag
SIMULATOR  ?= iPhone 17

# ── Help ─────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  Mero Tag — make targets"
	@echo ""
	@echo "  Setup"
	@echo "    setup        Check prereqs, install meroctl, bundle the contract"
	@echo "    tools        Install meroctl (core's, at the release ../../scripts/install-meroctl.sh pins)"
	@echo ""
	@echo "  Contract (Rust, a calimero:app component)"
	@echo "    logic-build  Build logic/ → logic/res/mero_tag.wasm + logic/res/abi.json"
	@echo "    logic-bundle Package the dev-signed .mpk a merod local cluster accepts"
	@echo "    logic-test   cargo test (pure helpers + the TestApp harness on core's engine)"
	@echo ""
	@echo "  Served page (app/: the iOS app's Calimero Cloud sign-in)"
	@echo "    web-build    Build app/dist, which the release bundle carries"
	@echo ""
	@echo "  iOS app (needs full Xcode + 'brew install xcodegen')"
	@echo "    app-gen      Generate MeroTag.xcodeproj from project.yml"
	@echo "    app-build    Build the app for the simulator"
	@echo "    app-run      Build + boot simulator + install + launch"
	@echo "    core-test    swift test the TagCore package (no simulator)"
	@echo "    app-test     Run the unit + UI test suites"
	@echo ""
	@echo "  Development cluster (merod local in Docker; see scripts/dev-cluster.sh)"
	@echo "    dev          Start the cluster, bundle the contract and install it"
	@echo "    dev-down     Stop the cluster (state is kept)"
	@echo ""
	@echo "  Aggregate"
	@echo "    test         logic-test + core-test (the no-simulator subset)"
	@echo "    clean        Remove build artifacts"
	@echo ""

# ── Setup ─────────────────────────────────────────────────────────────────────
setup:
	@bash scripts/setup.sh

# Core's `meroctl` builds the contract into a `calimero:app` component, writes
# its ABI, and packs the signed .mpk, at the release the repository pins
# (into ~/.local/bin; MEROCTL_ROOT=… for another place).
tools:
	../../scripts/install-meroctl.sh

# ── Contract ───────────────────────────────────────────────────────────────────
logic-build:
	mkdir -p logic/res
	meroctl app build logic --out logic/res/mero_tag.wasm --target-dir "$(CURDIR)/logic/target"
	meroctl app abi show logic/res/mero_tag.wasm > logic/res/abi.json

# What a `merod local` cluster installs (`meroctl app install --path`). Without
# `--key` it signs with the well-known development key, which the registry
# refuses by design; `--app-version` is a placeholder, because the registry owns
# the published number. No served page: a development cluster signs in with a
# soft passkey in the app itself.
logic-bundle: logic-build
	meroctl app pack logic --wasm logic/res/mero_tag.wasm --no-frontend --app-version 0.0.1 --out logic/dist/mero-tag-dev.mpk

logic-test:
	cd logic && cargo test

# ── Served page ──────────────────────────────────────────────────────────────
# app/dist, which the release bundle carries (`frontend-dir`). A release build
# sets VITE_CALIMERO_MIN_RELEASE (see .github/workflows/publish-component.yml).
web-build:
	pnpm install --frozen-lockfile && pnpm -F mero-tag build

# ── iOS app ─────────────────────────────────────────────────────────────────────
app-gen:
	@command -v xcodegen >/dev/null 2>&1 || { echo "xcodegen not found — run: brew install xcodegen"; exit 1; }
	cd $(APP_DIR) && xcodegen generate

app-build: app-gen
	xcodebuild -project $(XCODEPROJ) -scheme $(SCHEME) \
	  -destination 'platform=iOS Simulator,name=$(SIMULATOR)' \
	  -derivedDataPath $(APP_DIR)/.build build

app-run: app-build
	@echo "Booting simulator '$(SIMULATOR)'…"
	@xcrun simctl boot "$(SIMULATOR)" 2>/dev/null || true
	@open -a Simulator
	@APP=$$(find $(APP_DIR)/.build -name 'MeroTag.app' -path '*Debug-iphonesimulator*' | head -1); \
	  xcrun simctl install booted "$$APP" && \
	  xcrun simctl launch booted network.calimero.merotag

core-test:
	cd $(APP_DIR)/TagCore && swift test

app-test: app-gen
	xcodebuild -project $(XCODEPROJ) -scheme $(SCHEME) \
	  -destination 'platform=iOS Simulator,name=$(SIMULATOR)' \
	  -derivedDataPath $(APP_DIR)/.build test

# ── Development cluster ─────────────────────────────────────────────────────────
# A `merod local` cluster on localhost:2501-2503 (Docker on a Mac, where merod
# 1.0 does not run), with this contract installed. `scripts/dev-cluster.sh urls`
# prints the URL for the Simulator, a phone or the Android emulator.
dev: logic-bundle
	scripts/dev-cluster.sh up
	scripts/dev-cluster.sh install logic/dist/mero-tag-dev.mpk

dev-down:
	scripts/dev-cluster.sh down

# ── Aggregate ──────────────────────────────────────────────────────────────────
test: logic-test core-test

clean:
	cd logic && rm -rf res target
	rm -rf app/dist $(APP_DIR)/.build $(XCODEPROJ)
