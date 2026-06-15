.PHONY: help setup logic-build logic-test logic-e2e workflows kit-verify kit-test \
        node node2 invite stop dev \
        app-gen app-build app-run app-test test clean

APP_DIR    := app/MeroTag
KIT_DIR    := app/MeroKit
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
	@echo "  Backend (Calimero node)"
	@echo "    node         Build WASM, start node1, create a tracking space"
	@echo "    node2        Start a second node (for P2P sync demo)"
	@echo "    invite       Invite node2 into node1's space (run after node + node2)"
	@echo "    stop         Stop all dev nodes and free ports"
	@echo ""
	@echo "  Contract (Rust)"
	@echo "    logic-build  Compile logic/src → logic/res/mero_tag.wasm"
	@echo "    logic-test   cargo test (pure helpers)"
	@echo "    workflows    merobox WASM logic tests (real merod in Docker)"
	@echo "    logic-e2e    curl-based node integration test"
	@echo ""
	@echo "  MeroKit (Swift client)"
	@echo "    kit-verify   Smoke-test pure logic (Command Line Tools only — no Xcode)"
	@echo "    kit-test     Full XCTest suite (needs full Xcode)"
	@echo ""
	@echo "  iOS app (needs full Xcode + 'brew install xcodegen')"
	@echo "    app-gen      Generate MeroTag.xcodeproj from project.yml"
	@echo "    app-build    Build the app for the simulator"
	@echo "    app-run      Build + boot simulator + install + launch"
	@echo "    app-test     Run the UI test suite"
	@echo ""
	@echo "  Aggregate"
	@echo "    test         logic-test + kit-verify"
	@echo "    clean        Remove build artifacts"
	@echo ""

# ── Setup ─────────────────────────────────────────────────────────────────────
setup:
	@bash scripts/setup.sh

# ── Contract ───────────────────────────────────────────────────────────────────
logic-build:
	cd logic && bash build.sh

logic-test:
	cd logic && cargo test

logic-e2e:
	@bash scripts/integration-test.sh

workflows:
	@bash scripts/workflows.sh

# ── Node ─────────────────────────────────────────────────────────────────────
node:
	@bash scripts/dev-node.sh

node2:
	@bash scripts/dev-node2.sh

invite:
	@bash scripts/dev-invite.sh

dev: node
	@echo "Node up. Now run 'make app-run' (simulator) or open the Xcode project."

stop:
	@bash scripts/dev-node.sh  --clean 2>/dev/null || true
	@bash scripts/dev-node2.sh --clean 2>/dev/null || true
	@-pkill -f 'merod --node merotag-dev'   2>/dev/null || true
	@-pkill -f 'merod --node merotag-dev-2' 2>/dev/null || true
	@for p in 2440 2441 2540 2541; do \
	  for proto in tcp udp; do \
	    pids=$$(lsof -ti $$proto:$$p 2>/dev/null); \
	    [ -n "$$pids" ] && { echo "  killing $$proto:$$p: $$pids"; kill -9 $$pids 2>/dev/null || true; } || true; \
	  done; \
	done
	@rm -f /tmp/merotag-dev-node.pid /tmp/merotag-dev-node2.pid
	@printf '\033[32m  ✓  dev nodes stopped & cleaned\033[0m\n'

# ── MeroKit ────────────────────────────────────────────────────────────────────
kit-verify:
	cd $(KIT_DIR) && swift run merokit-verify

kit-test:
	cd $(KIT_DIR) && swift test

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
test: logic-test kit-verify

clean:
	cd logic && rm -rf res target
	cd $(KIT_DIR) && rm -rf .build
	rm -rf $(APP_DIR)/.build $(XCODEPROJ)
