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
# Built from mero-crm as it is on this branch, signed with the well-known dev
# key, which the registry refuses — this is never published.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p res
cargo mero bundle \
  --manifest-path ../../mero-crm/logic/Cargo.toml \
  --dev \
  --app-version 0.0.0 \
  --output res/mero-crm.mpk
echo "Mero CRM fixture bundle: $PWD/res/mero-crm.mpk"
