#!/usr/bin/env bash
set -euo pipefail

# ── Colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { printf "  ${GREEN}✓${RESET}  %s\n" "$*"; }
warn() { printf "  ${YELLOW}!${RESET}  %s\n" "$*"; }
err()  { printf "  ${RED}✗${RESET}  %s\n" "$*" >&2; }
info() { printf "  ${CYAN}→${RESET}  %s\n" "$*"; }
step() { printf "\n${BOLD}%s${RESET}\n" "$*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REQUIRED_RUST="1.89.0"
REQUIRED_NODE="18"
MISSING=()

# ── 1. Check required tools ────────────────────────────────────────────────────
step "Checking prerequisites…"

check_tool() {
  local cmd="$1"
  local install_hint="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$cmd found ($(command -v "$cmd"))"
  else
    err "$cmd not found — $install_hint"
    MISSING+=("$cmd")
  fi
}

check_tool rustc   "install via https://rustup.rs"
check_tool cargo   "install via https://rustup.rs"
check_tool pnpm    "install via https://pnpm.io/installation  or  npm i -g pnpm"
check_tool jq      "install via your package manager (brew install jq / apt install jq)"

if [[ ${#MISSING[@]} -gt 0 ]]; then
  printf "\n"
  err "Missing tools: ${MISSING[*]}"
  err "Install them and re-run this script."
  exit 1
fi

# ── 2. Rust version check ──────────────────────────────────────────────────────
step "Checking Rust version…"

rust_version=$(rustc --version | awk '{print $2}')
required_parts=(${REQUIRED_RUST//./ })
actual_parts=(${rust_version//./ })

version_ok=true
for i in 0 1 2; do
  r="${required_parts[$i]:-0}"
  a="${actual_parts[$i]:-0}"
  if (( a > r )); then break; fi
  if (( a < r )); then version_ok=false; break; fi
done

if $version_ok; then
  ok "rustc $rust_version (≥ $REQUIRED_RUST required)"
else
  warn "rustc $rust_version found, but $REQUIRED_RUST required by logic/rust-toolchain.toml"
  warn "Attempting to install the correct toolchain via rustup…"
  rustup toolchain install "$REQUIRED_RUST"
fi

# ── 3. WASM target ────────────────────────────────────────────────────────────
step "Ensuring wasm32-unknown-unknown target is installed…"

if rustup target list --installed | grep -q "wasm32-unknown-unknown"; then
  ok "wasm32-unknown-unknown already installed"
else
  info "Adding wasm32-unknown-unknown target…"
  rustup target add wasm32-unknown-unknown
  ok "wasm32-unknown-unknown added"
fi

# ── 4. Build Rust WASM logic ──────────────────────────────────────────────────
step "Building Rust WASM logic…"
info "Running logic/build.sh — this may take a few minutes on a cold build"
cd "$REPO_ROOT/logic"
bash build.sh
ok "logic/res/curb.wasm built"

# ── 5. Install frontend dependencies ─────────────────────────────────────────
step "Installing frontend dependencies…"
cd "$REPO_ROOT/app"
pnpm install
ok "app node_modules installed"

# ── 6. Optional: check merobox ────────────────────────────────────────────────
step "Checking optional tools…"

if command -v merobox >/dev/null 2>&1; then
  ok "merobox found (workflow tests available via  make workflows)"
else
  warn "merobox not found — workflow tests (make workflows) will not run"
  warn "Install: https://calimero-network.github.io/docs/merobox/install"
fi

if command -v wasm-opt >/dev/null 2>&1; then
  ok "wasm-opt found (WASM binary will be optimised)"
else
  warn "wasm-opt not found — WASM will not be size-optimised (optional)"
  warn "Install: binaryen package via brew / apt / cargo install wasm-opt"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
printf "\n${GREEN}${BOLD}✓  Setup complete!${RESET}\n\n"
printf "  Next steps:\n"
printf "    ${CYAN}make dev${RESET}        Start Vite dev server  (http://localhost:5173)\n"
printf "    ${CYAN}make test${RESET}       Run unit + e2e tests\n"
printf "    ${CYAN}make workflows${RESET}  Run merobox integration tests\n"
printf "    ${CYAN}make build${RESET}      Production build (WASM + frontend)\n"
printf "\n"
