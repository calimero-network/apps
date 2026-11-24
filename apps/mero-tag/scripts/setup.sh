#!/usr/bin/env bash
# scripts/setup.sh — check prerequisites and build the component contract.
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

[[ ${#MISSING[@]} -gt 0 ]] && { err "Missing: ${MISSING[*]}"; exit 1; }

step "Checking Rust wasm target…"
# The contract builds for core's component target.
(cd "$REPO_ROOT/logic" && rustup target list --installed | grep -q wasm32-wasip2) \
  && ok "wasm32-wasip2 installed" \
  || { (cd "$REPO_ROOT/logic" && rustup target add wasm32-wasip2) && ok "wasm32-wasip2 added"; }

step "Checking meroctl…"
"$REPO_ROOT/../../scripts/install-meroctl.sh" && export PATH="${MEROCTL_ROOT:-$HOME/.local}/bin:$PATH"
command -v meroctl >/dev/null 2>&1 && ok "meroctl $(meroctl --version | head -1)" \
  || { err "meroctl is not on PATH"; exit 1; }

step "Building the component contract + signed dev bundle…"
(cd "$REPO_ROOT" && make logic-bundle)
ok "logic/dist/mero-tag-dev.mpk built"

step "Optional tooling…"
command -v xcodegen >/dev/null 2>&1 && ok "xcodegen found" || warn "xcodegen not found — 'brew install xcodegen' (needed for the iOS app project)"
command -v xcodebuild >/dev/null 2>&1 && xcodebuild -version >/dev/null 2>&1 \
  && ok "full Xcode found" \
  || warn "full Xcode not active — needed to build/run the iOS app and XCTest suite (Command Line Tools alone can't)"
command -v pnpm >/dev/null 2>&1 && ok "pnpm found" || warn "pnpm not found — needed to build the served page (app/) for a release bundle"

printf "\n${GREEN}${BOLD}✓  Setup complete!${RESET}\n\n"
printf "  Next:\n"
printf "    ${CYAN}make logic-test${RESET} → unit-test the contract\n"
printf "    ${CYAN}make app-run${RESET}    → build + run the app in the Simulator (needs xcodegen + Xcode)\n"
printf "    ${CYAN}cargo run -p merod -- local${RESET} (in core, Linux or Docker) → a development cluster for the app\n\n"
printf "  See ${BOLD}requirements.md${RESET} for the full Mac / iPhone walkthrough.\n\n"
