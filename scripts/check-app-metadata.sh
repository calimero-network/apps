#!/usr/bin/env bash
# Assert every app's registry metadata agrees with the workspace.
#
# WHY THIS IS A SCRIPT AND NOT INHERITANCE
#
# `[package.metadata]` is NOT on cargo's inheritable list. Writing
#
#     min-runtime-version.workspace = true
#
# inside `[package.metadata.calimero]` does not resolve — `cargo metadata`
# reports the literal `{"workspace": true}` and cargo-mero receives a JSON
# object where it expects a version string. (Verified by running cargo, not
# read in a doc.) So the fleet-wide values live in
# `[workspace.metadata.calimero]`, which cargo DOES expose, and this asserts
# each app matches.
#
# Not a style check. Three bundles in the registry still advertise
# `minRuntimeVersion: 0.1.0` — cargo-mero's placeholder floor, which nobody
# verified — and a node older than the SDK an app was built against installs the
# bundle happily and then dies at context creation with `link error: unknown
# import`.
set -euo pipefail

cd "$(dirname "$0")/.."

meta=$(cargo metadata --no-deps --format-version 1)

want_min=$(jq -r '.metadata.calimero["min-runtime-version"] // empty' <<<"$meta")
if [[ -z "$want_min" ]]; then
  echo "::error::[workspace.metadata.calimero].min-runtime-version is not set in the root Cargo.toml"
  exit 1
fi
echo "workspace min-runtime-version: $want_min"

fail=0
seen_packages=""

# `-c` so each package is one line; the loop must not be a subshell or `fail`
# would be lost when it exits.
while read -r pkg; do
  name=$(jq -r '.name' <<<"$pkg")
  cal=$(jq -c '.metadata.calimero // empty' <<<"$pkg")

  if [[ -z "$cal" || "$cal" == "null" ]]; then
    echo "::error::$name has no [package.metadata.calimero] — it cannot be bundled or published"
    fail=1
    continue
  fi

  # ── package id: present, reverse-DNS, path-safe, unique ──────────────────
  # The id IS the deep-link slug and appears in every invite link ever shared,
  # and it becomes `dist/<package>.mpk`, so it must be path-safe.
  package=$(jq -r '.package // empty' <<<"$cal")
  if [[ -z "$package" ]]; then
    echo "::error::$name: [package.metadata.calimero].package is missing"
    fail=1
  else
    if [[ ! "$package" =~ ^[a-zA-Z0-9]+(\.[a-zA-Z0-9-]+)+$ ]]; then
      echo "::error::$name: package '$package' is not a path-safe reverse-DNS id"
      fail=1
    fi
    # Settled convention. Thirteen of the fourteen published bundles use
    # com.calimero.*; the one that does not is the exception we are not
    # repeating.
    if [[ "$package" != com.calimero.* ]]; then
      echo "::error::$name: package '$package' must start with 'com.calimero.'"
      fail=1
    fi
    if [[ " $seen_packages " == *" $package "* ]]; then
      echo "::error::$name: package id '$package' is already used by another app"
      fail=1
    fi
    seen_packages="$seen_packages $package"
  fi

  # ── min-runtime-version must equal the workspace value ───────────────────
  got_min=$(jq -r '.["min-runtime-version"] // empty' <<<"$cal")
  if [[ "$got_min" != "$want_min" ]]; then
    echo "::error::$name: min-runtime-version is '${got_min:-<unset>}', workspace says '$want_min'"
    fail=1
  fi

  # ── slug must equal the package id ───────────────────────────────────────
  # The desktop resolves a deep link by `Application.package`, so a slug that
  # differs from the package id produces links that silently never open.
  slug=$(jq -r '.slug // empty' <<<"$cal")
  if [[ -n "$slug" && "$slug" != "$package" ]]; then
    echo "::error::$name: slug '$slug' differs from package '$package' — a deep link resolves by package id"
    fail=1
  fi

  # ── frontend must be a bare https origin ────────────────────────────────
  # This doubles as the login callback's registered redirect URI, compared by
  # EXACT ORIGIN. http:// or a trailing path is how hosted login breaks while
  # local login keeps working.
  frontend=$(jq -r '.frontend // empty' <<<"$cal")
  if [[ -n "$frontend" && ! "$frontend" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?/?$ ]]; then
    echo "::error::$name: frontend '$frontend' should be a bare https origin (no path) — it is compared by exact origin for the login callback"
    fail=1
  fi

  [[ $fail -eq 0 ]] && echo "  ok  $name  ($package)"
done < <(jq -c '.packages[]' <<<"$meta")

if [[ $fail -ne 0 ]]; then
  echo
  echo "app metadata check FAILED"
  exit 1
fi
echo "all app metadata agrees with the workspace"
