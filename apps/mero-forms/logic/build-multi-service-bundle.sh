#!/bin/bash
# Builds the Mero CRM bundle FIXTURE the Playwright journey installs beside
# Mero Forms, so "Send to CRM" is tested against a real pipeline rather than a
# mock.
#
# The file name is CI's hook, not a description: ci.yml's wasm job runs
# `apps/<app>/logic/build-multi-service-bundle.sh` when it exists, and that job
# is the only one with a Rust toolchain. The output lands in res/, which the
# job uploads (the wasm-<app> artifact) for the e2e jobs.
#
# Mero Forms is a v1 app and hands responses to v1 CRM pipelines. Mero CRM in
# this repo is now a component app (Calimero 1.0), so the fixture is the LAST
# v1 Mero CRM, built from the commit before its port (V1_CRM below) in a
# throwaway worktree of that commit, where it is still a member of the root
# workspace. It is signed with the well-known dev key, which the registry
# refuses: this is never published. Its frontend is not needed (the journey
# calls the contract), so a placeholder stands in for `frontend-dir`.
set -euo pipefail

# The last commit of main with the v1 Mero CRM (calimero-sdk 0.12).
V1_CRM=c0f46f285a88700fd42b824e4abadec902951527

cd "$(dirname "$0")"
root=$(git rev-parse --show-toplevel)
out="$PWD/res/mero-crm.mpk"
mkdir -p res

tree=$(mktemp -d)/v1
trap 'git -C "$root" worktree remove --force "$tree" >/dev/null 2>&1 || true' EXIT
# CI checks out one commit; fetch the v1 one when this clone lacks it.
git -C "$root" cat-file -e "$V1_CRM^{commit}" 2>/dev/null \
  || git -C "$root" fetch --quiet --depth=1 origin "$V1_CRM"
git -C "$root" worktree add --quiet --detach "$tree" "$V1_CRM"

mkdir -p "$tree/apps/mero-crm/app/dist"
echo '<!doctype html><title>Mero CRM (v1 fixture)</title>' > "$tree/apps/mero-crm/app/dist/index.html"
# Share this checkout's target dir, so the v1 SDK builds once per job.
CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$root/target}" cargo mero bundle \
  --manifest-path "$tree/apps/mero-crm/logic/Cargo.toml" \
  --dev \
  --app-version 0.0.0 \
  --output "$out"
echo "Mero CRM (v1) fixture bundle: $out"
