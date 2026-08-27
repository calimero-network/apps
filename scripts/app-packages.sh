#!/usr/bin/env bash
# Resolve app CARGO PACKAGE NAMES — the one place that mapping lives.
#
# WHY THIS IS SHARED
#
# ci.yml and release.yml both need "which apps does this change affect", and
# publish-bundle.yml uses the answer as BOTH a directory (`apps/$APP/logic`) and
# a cargo package name (`select(.name == $app)`). Two workflows deriving that
# independently is how they drift: release.yml's changed-app branch took the name
# from the PATH SEGMENT (`apps/<dir>/logic/...`) while its other branches took it
# from `cargo metadata | .name`. Those agree only while every app directory is
# named exactly like its crate — so the first app where they differ fails with
# "no [package.metadata.calimero].package", and only on the changed-app path,
# never on a dispatch.
#
# Usage:
#   scripts/app-packages.sh all           JSON array of every app package
#   scripts/app-packages.sh from-paths    JSON array for paths on stdin
#
# `from-paths` reads whitespace-separated paths and maps any under an app
# directory to that app's package, so it covers logic/ and app/ alike.
#
# Deliberately no bash associative arrays: macOS ships bash 3.2, which does not
# have them, and a script that only runs on the CI runner is a script nobody can
# test before pushing. The mapping is done in jq instead.
set -euo pipefail

cd "$(dirname "$0")/.."

# [{dir, name}] for every crate carrying calimero app metadata. `dir` is the app
# root — the PARENT of logic/ — which is what the workflows path-match against.
apps_json() {
  cargo metadata --no-deps --format-version 1 | jq -c '
    [ .packages[]
      | select(.metadata.calimero != null)
      | { dir: (.manifest_path | split("/") | .[-3]), name: .name }
    ]
  '
}

case "${1:-}" in
  all)
    apps_json | jq -c '[.[].name] | sort'
    ;;
  from-paths)
    paths=$(tr '[:space:]' '\n' | sed '/^$/d' | jq -R . | jq -sc .)
    apps=$(apps_json)

    # Warn about a path under apps/ that maps to no crate — a stray file, or a
    # new app whose Cargo.toml is not committed yet. Skipping it silently would
    # drop it from CI with nothing to notice.
    jq -r --argjson apps "$apps" '
      [ .[] | capture("^apps/(?<dir>[^/]+)/") .dir ] | unique
      | map(select(. as $d | ($apps | map(.dir) | index($d)) == null))
      | .[]
    ' <<<"$paths" | while read -r orphan; do
      echo "::warning::apps/$orphan changed but is not a cargo package with [package.metadata.calimero] — not covered by this run" >&2
    done

    jq -c --argjson apps "$apps" '
      [ .[] | capture("^apps/(?<dir>[^/]+)/") .dir ] | unique
      | map(. as $d | ($apps[] | select(.dir == $d) | .name))
      | unique | sort
    ' <<<"$paths"
    ;;
  *)
    echo "usage: $0 {all|from-paths}" >&2
    exit 2
    ;;
esac
