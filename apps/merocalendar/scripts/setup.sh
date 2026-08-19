#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { printf "  ${GREEN}✓${RESET}  %s\n" "$*"; }
warn() { printf "  ${YELLOW}!${RESET}  %s\n" "$*"; }
err()  { printf "  ${RED}✗${RESET}  %s\n" "$*" >&2; }
step() { printf "\n${BOLD}%s${RESET}\n" "$*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MISSING=()

step "Checking prerequisites…"

check_tool() {
  command -v "$1" >/dev/null 2>&1 && ok "$1 found" || { err "$1 not found — $2"; MISSING+=("$1"); }
}

check_tool rustc  "install via https://rustup.rs"
check_tool cargo  "install via https://rustup.rs"
check_tool pnpm   "npm i -g pnpm"
check_tool jq     "brew install jq / apt install jq"

[[ ${#MISSING[@]} -gt 0 ]] && { err "Missing: ${MISSING[*]}"; exit 1; }

step "Checking Rust wasm target…"
rustup target list --installed | grep -q "wasm32-unknown-unknown" \
  && ok "wasm32-unknown-unknown installed" \
  || { rustup target add wasm32-unknown-unknown && ok "wasm32-unknown-unknown added"; }

step "Building Rust WASM logic…"
# `cargo mero build`, not the old `logic/build.sh`. cargo-mero replaced the
# per-app build scripts: it applies the release profile, runs the wasm-opt it
# bundles (never one off PATH), emits the ABI from a HOST build and embeds it as
# the `calimero_abi_v1` section, then writes logic/res/merocalendar.wasm — the
# same path build.sh used, so nothing downstream moves. The ABI section is not
# cosmetic: the node reads it to plan an upgrade, so a wasm built the old way is
# not the artifact CI and the registry publish produce.
# Install it with:  cargo install --git https://github.com/calimero-network/core \
#                     --tag 0.11.0-rc.24 cargo-mero --locked
command -v cargo-mero >/dev/null 2>&1 \
  || { err "cargo-mero not found — install it (see comment above)"; exit 1; }
cd "$REPO_ROOT/logic" && cargo mero build
ok "logic/res/merocalendar.wasm built"

step "Installing frontend dependencies…"
cd "$REPO_ROOT/app" && pnpm install
ok "app node_modules installed"

step "Checking optional tools…"
command -v merobox >/dev/null 2>&1 \
  && ok "merobox found" \
  || warn "merobox not found — workflow tests unavailable"
command -v wasm-opt >/dev/null 2>&1 \
  && ok "wasm-opt found" \
  || warn "wasm-opt not found — WASM won't be size-optimised (optional)"

printf "\n${GREEN}${BOLD}✓  Setup complete!${RESET}\n\n"
printf "  Next:\n"
printf "    ${CYAN}make dev-node${RESET}  →  start node + install app\n"
printf "    ${CYAN}make dev${RESET}       →  http://localhost:5173\n\n"
