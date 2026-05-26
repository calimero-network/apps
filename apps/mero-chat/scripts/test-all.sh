#!/usr/bin/env bash
# scripts/test-all.sh — Full validation pipeline for curb.
#
# Runs the three one-shot Make targets that verify the project end-to-end:
#   1. make build           — Rust WASM logic + frontend bundle (WASM built once)
#   2. make ci-no-build     — 2-node merod cluster, all RPC/admin tests, teardown
#   3. make workflows-no-build — merobox workflow tests (reuses the already-built WASM)
#
# Each phase's output is shown live AND captured to a log file. The script
# tracks pass/fail per phase and prints a coloured summary at the end. Exits 0
# if every phase passes, 1 otherwise (with log paths for failed phases).
#
# `make start` is intentionally skipped — it ends with `pnpm dev` which never
# exits. `make ci-no-build` exercises 2-node bring-up + sync teardown instead.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LOG_DIR="/tmp/curb-test-all-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"

# Colours (skip in non-tty contexts).
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_CYAN=$'\033[36m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""; C_BOLD=""; C_RESET=""
fi

# Phase tracking — parallel arrays kept in sync.
PHASE_NAMES=()
PHASE_RESULTS=()   # "PASS" | "FAIL"
PHASE_LOGS=()
PHASE_DURATIONS=() # seconds

run_phase() {
  local name="$1" cmd="$2"
  local log_file="$LOG_DIR/${name// /-}.log"

  printf '\n%s▶  %s%s\n' "$C_BOLD$C_CYAN" "$name" "$C_RESET"
  printf '   %scmd:%s %s\n' "$C_YELLOW" "$C_RESET" "$cmd"
  printf '   %slog:%s %s\n\n' "$C_YELLOW" "$C_RESET" "$log_file"

  local start=$SECONDS
  local result="PASS"

  # Run in repo root; tee output live to terminal AND to log file.
  # pipefail (set at top) ensures the exit code reflects the command, not tee.
  if ( cd "$REPO_ROOT" && eval "$cmd" ) 2>&1 | tee "$log_file"; then
    result="PASS"
    printf '\n   %s✓  %s passed%s' "$C_GREEN" "$name" "$C_RESET"
  else
    result="FAIL"
    printf '\n   %s✗  %s failed%s' "$C_RED" "$name" "$C_RESET"
  fi
  local elapsed=$((SECONDS - start))
  printf '  (%ss)\n' "$elapsed"

  PHASE_NAMES+=("$name")
  PHASE_RESULTS+=("$result")
  PHASE_LOGS+=("$log_file")
  PHASE_DURATIONS+=("$elapsed")
}

printf '%s%s═══════════════════════════════════════════════%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
printf '%s%s  curb — full validation pipeline%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
printf '%s%s═══════════════════════════════════════════════%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
printf '  Logs directory: %s%s%s\n' "$C_YELLOW" "$LOG_DIR" "$C_RESET"

# WASM is built once in phase 1; ci and workflows reuse it via --no-build variants.
run_phase "make build"              "make build"
run_phase "make ci-no-build"        "make ci-no-build"
run_phase "make workflows-no-build" "make workflows-no-build"

# ── Summary ───────────────────────────────────────────────────────────────────

total=${#PHASE_NAMES[@]}
fails=0
for r in "${PHASE_RESULTS[@]}"; do
  [ "$r" = "FAIL" ] && fails=$((fails + 1))
done

printf '\n%s%s═══════════════════════════════════════════════%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
printf '%s%s  Summary%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
printf '%s%s═══════════════════════════════════════════════%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"

for i in "${!PHASE_NAMES[@]}"; do
  if [ "${PHASE_RESULTS[$i]}" = "PASS" ]; then
    printf '  %s✓%s  %-26s  %ss\n' "$C_GREEN" "$C_RESET" "${PHASE_NAMES[$i]}" "${PHASE_DURATIONS[$i]}"
  else
    printf '  %s✗%s  %-26s  %ss  %s→ %s%s\n' \
      "$C_RED" "$C_RESET" "${PHASE_NAMES[$i]}" "${PHASE_DURATIONS[$i]}" \
      "$C_RED" "${PHASE_LOGS[$i]}" "$C_RESET"
  fi
done

printf '\n'

if [ "$fails" -eq 0 ]; then
  printf '%s%s  ALL %s PHASES PASSED%s\n\n' "$C_BOLD" "$C_GREEN" "$total" "$C_RESET"
  exit 0
fi

printf '%s%s  %s/%s PHASES FAILED%s\n\n' "$C_BOLD" "$C_RED" "$fails" "$total" "$C_RESET"
exit 1
