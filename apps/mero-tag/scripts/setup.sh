#!/usr/bin/env bash
# scripts/setup.sh — check prerequisites and build the WASM contract.
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { printf "  ${GREEN}✓${RESET}  %s\n" "$*"; }
warn() { printf "  ${YELLOW}!${RESET}  %s\n" "$*"; }
err()  { printf "  ${RED}✗${RESET}  %s\n" "$*" >&2; }
step() { printf "\n${BOLD}%s${RESET}\n" "$*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MISSING=()

step "Checking prerequisites…"
check() { command -v "$1" >/dev/null 2>&1 && ok "$1 found" || { err "$1 not found — $2"; MISSING+=("$1"); }; }
check rustc   "install via https://rustup.rs"
check cargo   "install via https://rustup.rs"
check jq      "brew install jq"
check merod   "install Calimero node (merod)"
check swift   "install Xcode or Command Line Tools"

[[ ${#MISSING[@]} -gt 0 ]] && { err "Missing: ${MISSING[*]}"; exit 1; }

step "Checking Rust wasm target…"
rustup target list --installed | grep -q wasm32-unknown-unknown \
  && ok "wasm32-unknown-unknown installed" \
  || { rustup target add wasm32-unknown-unknown && ok "wasm32-unknown-unknown added"; }

step "Building WASM contract…"
(cd "$REPO_ROOT/logic" && bash build.sh)
ok "logic/res/mero_tag.wasm built"

step "Optional tooling…"
command -v xcodegen >/dev/null 2>&1 && ok "xcodegen found" || warn "xcodegen not found — 'brew install xcodegen' (needed for the iOS app project)"
command -v xcodebuild >/dev/null 2>&1 && xcodebuild -version >/dev/null 2>&1 \
  && ok "full Xcode found" \
  || warn "full Xcode not active — needed to build/run the iOS app and XCTest suite (Command Line Tools alone can't)"
command -v wasm-opt >/dev/null 2>&1 && ok "wasm-opt found" || warn "wasm-opt not found — WASM won't be size-optimised (optional)"

printf "\n${GREEN}${BOLD}✓  Setup complete!${RESET}\n\n"
printf "  Next:\n"
printf "    ${CYAN}make node${RESET}      → start the dev node + create a tracking space\n"
printf "    ${CYAN}make kit-verify${RESET} → smoke-test MeroKit (no Xcode needed)\n"
printf "    ${CYAN}make app-gen${RESET}   → generate MeroTag.xcodeproj (needs xcodegen + Xcode)\n\n"
printf "  See ${BOLD}requirements.md${RESET} for the full Mac / iPhone walkthrough.\n\n"
