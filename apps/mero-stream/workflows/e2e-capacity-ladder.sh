#!/bin/sh
# Wrapper: merobox runs `script` steps through `sh`, so the .mjs needs an explicit
# node. Same reason this lives here rather than in scripts/ as e2e-ephemeral-
# frames.sh: merobox rejects a `script:` path containing '..' as path traversal
# (unlike `path:`, which the wasm install uses with '../logic/…'), so the step
# names a path with no '..' and the hop up to app/e2e/ happens HERE, in the
# shell, where no such guard applies.
exec node "$(dirname "$0")/../app/e2e/capacity-ladder.mjs" "$@"
