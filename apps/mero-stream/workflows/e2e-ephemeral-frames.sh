#!/bin/sh
# Wrapper: merobox runs `script` steps through `sh`, so the .mjs needs an
# explicit node. The assertions live in JS because ephemeral presence has no read
# endpoint — a client learns it only by subscribing to the event stream — and an
# SSE client in shell is not a reasonable thing to write.
#
# This lives in workflows/ rather than next to the repo's other shell helpers in
# scripts/, and it has to: merobox rejects a `script:` path containing '..' as
# path traversal (unlike `path:`, which the wasm install uses with '../logic/…').
# The step therefore names a path with no '..' in it, and reaching the .mjs one
# directory up is done HERE, in the shell, where no such guard applies.
exec node "$(dirname "$0")/../app/e2e/ephemeral-frames.mjs" "$@"
