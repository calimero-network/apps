.PHONY: help setup logic-build logic-bundle logic-test logic-e2e workflows \
        node node2 invite stop dev \
        app-gen app-build app-run app-test test clean

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
	@echo "    setup        Check prereqs + build the WASM contract"
	@echo ""
	@echo "  Backend (Calimero node)"
	@echo "    node         Build WASM, start node1, create a tracking space"
	@echo "    node2        Start a second node (for P2P sync demo)"
	@echo "    invite       Invite node2 into node1's space (run after node + node2)"
	@echo "    stop         Stop all dev nodes and free ports"
	@echo ""
	@echo "  Contract (Rust)"
	@echo "    logic-build  Compile logic/src → logic/res/mero_ar.wasm (+ embed the ABI)"
	@echo "    logic-bundle Package the signed .mpk a node will actually accept"
	@echo "    logic-test   cargo test (pure helpers)"
	@echo "    workflows    merobox WASM logic tests (real merod in Docker)"
	@echo "                 logic-test.yml (1 node) + identity-and-roles.yml (2 nodes)"
	@echo "    logic-e2e    curl-based node integration test"
	@echo ""
	@echo "  iOS app (needs full Xcode + 'brew install xcodegen')"
	@echo "    app-gen      Generate MeroAR.xcodeproj from project.yml"
	@echo "    app-build    Build the app for the simulator"
	@echo "    app-run      Build + boot simulator + install + launch"
	@echo "    app-test     Run the UI test suite"
	@echo ""
	@echo "  Aggregate"
	@echo "    test         logic-test + app-test"
	@echo "    clean        Remove build artifacts"
	@echo ""

# ── Setup ─────────────────────────────────────────────────────────────────────
setup:
	@bash scripts/setup.sh

# ── Contract ───────────────────────────────────────────────────────────────────
logic-build:
	cd logic && cargo mero build

# What a node installs. Raw wasm is out of the protocol since core#3652
# (0.11.0-rc.31), so this — not logic-build — is what `node`, `node2` and the
# merobox workflows hand it. `--dev` signs with the well-known development key,
# which the registry refuses by design; `--app-version` is a placeholder because
# the registry owns the published number (see logic/Cargo.toml).
logic-bundle:
	cd logic && cargo mero bundle --dev --no-icon --app-version 0.0.0 --output res/mero-ar.mpk

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
	@-pkill -f 'merod --node meroar-dev'   2>/dev/null || true
	@-pkill -f 'merod --node meroar-dev-2' 2>/dev/null || true
	@for p in 2450 2451 2550 2551; do \
	  for proto in tcp udp; do \
	    pids=$$(lsof -ti $$proto:$$p 2>/dev/null); \
	    [ -n "$$pids" ] && { echo "  killing $$proto:$$p: $$pids"; kill -9 $$pids 2>/dev/null || true; } || true; \
	  done; \
	done
	@rm -f /tmp/meroar-dev-node.pid /tmp/meroar-dev-node2.pid
	@printf '\033[32m  ✓  dev nodes stopped & cleaned\033[0m\n'

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
	@APP=$$(find $(APP_DIR)/.build -name 'MeroAR.app' -path '*Debug-iphonesimulator*' | head -1); \
	  xcrun simctl install booted "$$APP" && \
	  xcrun simctl launch booted network.calimero.meroar

app-test: app-gen
	xcodebuild -project $(XCODEPROJ) -scheme $(SCHEME) \
	  -destination 'platform=iOS Simulator,name=$(SIMULATOR)' \
	  -derivedDataPath $(APP_DIR)/.build test

# ── Aggregate ──────────────────────────────────────────────────────────────────
# The Swift client itself is the shared SDK (calimero-network/swift-sdk, pinned
# by revision in app/MeroAR/project.yml) and is tested in its own repo; what this
# repo tests is the contract plus this app against that pin.
test: logic-test app-test

clean:
	cd logic && rm -rf res target
	rm -rf $(APP_DIR)/.build $(XCODEPROJ)
