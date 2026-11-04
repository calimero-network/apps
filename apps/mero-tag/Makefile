.PHONY: help setup logic-build logic-bundle logic-test \
        app-gen app-build app-run app-test test clean

APP_DIR    := app/MeroTag
XCODEPROJ  := $(APP_DIR)/MeroTag.xcodeproj
SCHEME     := MeroTag
SIMULATOR  ?= iPhone 17

# ── Help ─────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  Mero Tag — make targets"
	@echo ""
	@echo "  Setup"
	@echo "    setup        Check prereqs + build the WASM contract"
	@echo ""
	@echo "  Contract (Rust)"
	@echo "    logic-build  Compile logic/src → logic/res/mero_tag.wasm (+ embed the ABI)"
	@echo "    logic-bundle Package the signed .mpk a node will actually accept"
	@echo "    logic-test   cargo test (pure helpers + TestHost 1.0 semantics)"
	@echo ""
	@echo "  iOS app (needs full Xcode + 'brew install xcodegen')"
	@echo "    app-gen      Generate MeroTag.xcodeproj from project.yml"
	@echo "    app-build    Build the app for the simulator"
	@echo "    app-run      Build + boot simulator + install + launch"
	@echo "    app-test     Run the unit + UI test suites"
	@echo ""
	@echo "  Aggregate"
	@echo "    test         logic-test (the no-Xcode subset)"
	@echo "    clean        Remove build artifacts"
	@echo ""

# ── Setup ─────────────────────────────────────────────────────────────────────
setup:
	@bash scripts/setup.sh

# ── Contract ───────────────────────────────────────────────────────────────────
logic-build:
	cd logic && cargo mero build

# What a `merod local` cluster installs (`meroctl app install --path`). `--dev`
# signs with the well-known development key, which the registry refuses by
# design; `--app-version` is a placeholder, because the registry owns the
# published number.
logic-bundle:
	cd logic && cargo mero bundle --dev --no-icon --app-version 0.0.1 --output dist/mero-tag-dev.mpk

logic-test:
	cd logic && cargo test

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

app-test: app-gen
	xcodebuild -project $(XCODEPROJ) -scheme $(SCHEME) \
	  -destination 'platform=iOS Simulator,name=$(SIMULATOR)' \
	  -derivedDataPath $(APP_DIR)/.build test

# ── Aggregate ──────────────────────────────────────────────────────────────────
test: logic-test

clean:
	cd logic && rm -rf res target
	rm -rf $(APP_DIR)/.build $(XCODEPROJ)
