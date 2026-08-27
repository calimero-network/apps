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
# object where it expects a version string. (Verified by running cargo.)
#
# The fleet-wide values live in `[workspace.metadata.mero-apps]` and NOT in
# `[workspace.metadata.calimero]`: cargo-mero REPLACES an app's package table
# with the workspace one when both exist, which masks every app's identity in a
# multi-app workspace. See the comment in the root Cargo.toml.
#
# Not a style check. Three bundles in the registry still advertise
# `minRuntimeVersion: 0.1.0` — cargo-mero's placeholder floor, which nobody
# verified — and a node older than the SDK an app was built against installs the
# bundle happily and then dies at context creation with `link error: unknown
# import`.
set -euo pipefail

cd "$(dirname "$0")/.."

meta=$(cargo metadata --no-deps --format-version 1)

want_min=$(jq -r '.metadata["mero-apps"]["min-runtime-version"] // empty' <<<"$meta")
if [[ -z "$want_min" ]]; then
  echo "::error::[workspace.metadata.mero-apps].min-runtime-version is not set in the root Cargo.toml"
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
    # A workspace member with no calimero table is a SHARED CRATE, not a broken
    # app — `crates/*` is exactly that, and both the root Cargo.toml and ci.yml
    # tell you to add it. Hard-failing here would red this job the moment
    # someone did, while the CI matrices (which select ON the table) would
    # correctly ignore it.
    #
    # An APP without the table is still an error, and that is caught below by
    # requiring every apps/*/logic member to have one.
    echo "  --  $name (no calimero table; treated as a shared crate)"
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

# The other direction: a crate under apps/*/logic MUST have the table, or it is
# an app that silently cannot be bundled — and, because the CI matrices select on
# the table, an app that no job would ever build.
while read -r manifest name; do
  case "$manifest" in
    */apps/*/logic/Cargo.toml) ;;
    *) continue ;;
  esac
  has=$(jq -r --arg n "$name" '.packages[] | select(.name == $n) | .metadata.calimero // empty' <<<"$meta")
  if [[ -z "$has" ]]; then
    echo "::error::$name lives under apps/*/logic but has no [package.metadata.calimero] — it cannot be bundled, and no CI job would build it"
    fail=1
  fi
done < <(jq -r '.packages[] | [.manifest_path, .name] | @tsv' <<<"$meta")

# ── every merobox scenario must run the merod image the workspace declares ──
#
# This is what makes `merod-image` live config rather than a comment. The drift
# it catches is the one that started the fleet-wide rc.25 sweep: contracts pinned
# to one release while every scenario still started a node from the previous one.
# Green the whole time, until a contract touches a host function the older node
# does not have.
want_image=$(jq -r '.metadata["mero-apps"]["merod-image"] // empty' <<<"$meta")
if [[ -z "$want_image" ]]; then
  echo "::error::[workspace.metadata.mero-apps].merod-image is not set in the root Cargo.toml"
  exit 1
fi
echo "workspace merod image: $want_image"

shopt -s nullglob
for f in apps/*/logic/workflows/*.yml; do
  while read -r img; do
    if [[ "$img" != "$want_image" ]]; then
      echo "::error file=$f::runs $img, workspace declares $want_image"
      fail=1
    fi
  done < <(grep -oE 'ghcr\.io/calimero-network/merod:[A-Za-z0-9._-]+' "$f" | sort -u)
done

if [[ $fail -ne 0 ]]; then
  echo
  echo "app metadata check FAILED"
  exit 1
fi
echo "all app metadata agrees with the workspace"
