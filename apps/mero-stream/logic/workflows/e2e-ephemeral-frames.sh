#!/bin/sh
# Wrapper: merobox runs `script` steps through `sh`, so the .mjs needs an
# explicit node. The assertions live in JS because ephemeral presence has no read
# endpoint — a client learns it only by subscribing to the event stream — and an
# SSE client in shell is not a reasonable thing to write.
#
# This lives beside the scenario rather than in the app's scripts/, and it has
# to: merobox rejects a `script:` path containing '..' as path traversal, so the
# step names a forward path only and the hop UP to app/e2e/ happens HERE, in the
# shell, where no such guard applies.
#
# Two levels up, not one: the monorepo puts scenarios at
# apps/mero-stream/logic/workflows/, so app/ is a sibling of logic/, not of
# workflows/. It was ../app/e2e when this file lived at <repo>/workflows/.
exec node "$(dirname "$0")/../../app/e2e/ephemeral-frames.mjs" "$@"
