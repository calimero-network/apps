#!/bin/sh
# Wrapper: merobox runs `script` steps through `sh`, so the .mjs needs an
# explicit node. Same reason this lives beside its scenario rather than in the
# app's scripts/ as e2e-ephemeral-frames.sh: merobox rejects a `script:` path
# containing '..' as path traversal, so the step names a forward path only and
# the hop up to app/e2e/ happens HERE, in the shell.
#
# THREE levels up: this probe sits at apps/mero-stream/logic/workflows/probes/,
# one deeper than the scenarios ci.yml gates on.
exec node "$(dirname "$0")/../../../app/e2e/capacity-ladder.mjs" "$@"
