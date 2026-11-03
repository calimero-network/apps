#!/usr/bin/env bash
# The contract's ABI (apps/mero-pass/logic/res/abi.json) is a Calimero 1.0 component ABI, which
# the v1 abi-codegen does not read. The two clients are kept by hand against it, in step with the
# web app's app/src/lib/meroPass.ts and vaultApi.ts:
#
#   ios/PassCore/Sources/PassGenerated/PassClient.swift
#   android/app/src/main/kotlin/network/calimero/pass/generated/PassClient.kt
#
# WireTests (Swift) and WireTest (Kotlin) pin their method names and wire shapes.
set -euo pipefail
echo "regenerate-client.sh: the mobile clients are kept by hand against the component ABI; see ../README.md (Contract client)." >&2
exit 1
