#!/usr/bin/env bash
# The registry side of a component app's release: what version comes next, and
# whether a signed bundle continues the package's published lineage. Read-only:
# every request here is a GET, so it runs the same on a laptop as in CI.
#
# Usage:
#   scripts/registry-release.sh next-version PACKAGE [X.Y.Z]   print the version to publish
#   scripts/registry-release.sh check-signer PACKAGE SIGNER_ID  fail unless SIGNER_ID may publish PACKAGE
#
# The same rules as publish-bundle.yml (the 0.x pipeline) and mero-tag's
# deploy-bundle.yml:
#
#   * THE REGISTRY OWNS THE VERSION: the highest published X.Y.Z appVersion with
#     the patch incremented, 0.0.1 for a package nothing has published; walked up
#     past versions the (eventually consistent) listing does not show yet. An
#     explicit X.Y.Z is taken as given, but must still be free.
#   * THE REGISTRY PINS THE SIGNER per package, and the node derives the
#     ApplicationId from (package, signer): a different key would land as a NEW
#     application, not an upgrade, so a mismatch fails. A lineage signed with the
#     well-known development key cannot be continued (the registry refuses dev
#     signatures), so it is treated as a first publish, loudly.
#   * An unreachable or unreadable registry stops the release: guessing would
#     sign below, or over, what is already out there.
#
# CALIMERO_REGISTRY_URL overrides https://apps.calimero.network.
set -euo pipefail

registry="${CALIMERO_REGISTRY_URL:-https://apps.calimero.network}"
api="${registry%/}/api/v2/bundles"

# The well-known development key's signerId (core's `mero_sign::dev_signer_id`,
# the same key cargo-mero's --dev used): `mero-component bundle --dev` signs
# with it.
DEV_SIGNER=did:key:z6MknF3p5L5FDHJQ7FREUapuX4Wmp4MtF6WrHYaXS2B3eZQd

notice() { echo "::notice::$*" >&2; }
fail() {
  echo "::error::$*" >&2
  exit 1
}

valid_package() {
  case "$1" in
    "" | *[!a-z0-9.-]*) fail "unexpected package id '$1'" ;;
  esac
}

listing() {
  local response
  if ! response=$(curl -fsS --retry 3 --retry-delay 2 --max-time 30 "$api?package=$1"); then
    fail "could not reach the registry ($api?package=$1) — refusing to guess"
  fi
  if ! jq -e 'type == "array"' >/dev/null <<<"$response"; then
    fail "registry response is not a bundle list: $response"
  fi
  printf '%s' "$response"
}

# 404 free, 200 taken, anything else stops.
version_status() {
  curl -s -o /dev/null -w '%{http_code}' --retry 3 --retry-delay 2 --max-time 30 \
    "$api/$1/$2" || echo "000"
}

next_version() {
  local package=$1 explicit=${2:-} version response count code next
  valid_package "$package"

  if [ -n "$explicit" ]; then
    [[ "$explicit" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
      fail "version override must be exactly X.Y.Z (got '$explicit')"
    code=$(version_status "$package" "$explicit")
    case "$code" in
      404) ;;
      200) fail "$package $explicit is already published — the registry never takes a version twice" ;;
      *) fail "registry returned $code for $package $explicit — refusing to publish blind" ;;
    esac
    notice "publishing $package $explicit (explicit override)"
    echo "$explicit"
    return
  fi

  response=$(listing "$package")
  count=$(jq -r 'length' <<<"$response")
  if [ "$count" = "0" ]; then
    version="0.0.1"
    notice "nothing published for $package yet — starting at $version"
  else
    # Every entry, never the listing's order; one with no readable X.Y.Z is an
    # unrecognized scheme, and defaulting would sign below what is published.
    version=$(jq -r '
      [ .[].appVersion // empty
        | select(test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))
        | split(".") | map(tonumber) ]
      | sort
      | if length == 0 then "" else (last | "\(.[0]).\(.[1]).\(.[2]+1)") end
    ' <<<"$response")
    [ -n "$version" ] ||
      fail "registry listed $count bundle(s) for $package but none had a readable X.Y.Z appVersion"
    notice "highest published for $package: $(jq -r '[.[].appVersion // empty] | join(", ")' <<<"$response") — proposing $version"
  fi

  # The listing lags a publish by a little; the per-version lookup does not.
  for _ in $(seq 1 20); do
    code=$(version_status "$package" "$version")
    case "$code" in
      404)
        notice "releasing $package $version"
        echo "$version"
        return
        ;;
      200)
        next=$(awk -F. '{ printf "%d.%d.%d", $1, $2, $3 + 1 }' <<<"$version")
        notice "$package $version is already published (the listing lags) — trying $next"
        version=$next
        ;;
      *) fail "registry returned $code for $package $version — refusing to guess" ;;
    esac
  done
  fail "no free version for $package within 20 patches of the listing's proposal"
}

check_signer() {
  local package=$1 signer=$2 response signers count
  valid_package "$package"
  [[ "$signer" =~ ^did:key:z[1-9A-HJ-NP-Za-km-z]+$ ]] || fail "'$signer' is not a did:key signer id"
  [ "$signer" != "$DEV_SIGNER" ] ||
    fail "the bundle is signed with the well-known DEVELOPMENT key; the registry refuses it. Sign with MERO_SIGN_KEY."

  response=$(listing "$package")
  # Every DISTINCT signerId, not `.[0]`: more than one should be impossible (the
  # registry pins it), so it stops the release rather than picking one.
  signers=$(jq -er '[.[].signerId // empty] | unique | join(" ")' <<<"$response") ||
    fail "registry returned a listing this check cannot parse: $response"
  count=$(wc -w <<<"$signers" | tr -d ' ')

  if [ "$count" -gt 1 ]; then
    fail "registry lists MULTIPLE signers for $package ($signers) — refusing to guess which lineage this release continues"
  elif [ -z "$signers" ]; then
    notice "nothing published for $package — first publish, it pins $signer"
  elif [ "$signers" = "$DEV_SIGNER" ]; then
    notice "the published lineage of $package is dev-key-signed and cannot be continued; publishing under $signer mints a NEW application id (existing installs see a new app, not an upgrade)"
  elif [ "$signers" != "$signer" ]; then
    fail "the bundle's signerId ($signer) does not match the published signerId of $package ($signers). The registry pins the signer per package and the node derives ApplicationId from (package, signer), so this would land as a new application instead of an upgrade. Sign with the key that signed the published versions."
  else
    echo "signer matches the published lineage of $package ($signer)" >&2
  fi
}

case "${1:-}" in
  next-version)
    next_version "${2:?usage: $0 next-version PACKAGE [X.Y.Z]}" "${3:-}"
    ;;
  check-signer)
    check_signer "${2:?usage: $0 check-signer PACKAGE SIGNER_ID}" "${3:?usage: $0 check-signer PACKAGE SIGNER_ID}"
    ;;
  *)
    echo "usage: $0 {next-version PACKAGE [X.Y.Z] | check-signer PACKAGE SIGNER_ID}" >&2
    exit 2
    ;;
esac
