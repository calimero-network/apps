#!/usr/bin/env bash
# The contract's ABI (apps/mero-vote/logic/res/abi.json) is a Calimero 1.0 component ABI, which
# the v1 abi-codegen does not read. The two clients are kept by hand against it, in step with the
# web adapter (apps/mero-vote/app/src/meroVote.ts):
#
#   ios/VoteCore/Sources/VoteCore/VoteClient.swift
#   android/app/src/main/kotlin/network/calimero/vote/generated/VoteClient.kt
#
# WireTests (Swift) and WireTest (Kotlin) pin their method names and wire shapes.
set -euo pipefail
echo "regenerate-client.sh: the mobile clients are kept by hand against the component ABI; see ../README.md (Contract client)." >&2
exit 1
