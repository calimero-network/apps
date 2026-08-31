#!/usr/bin/env bash
# Builds the signed .mpk you install with `meroctl app install`.
#
# A thin wrapper around `cargo mero bundle`, kept because setup.sh and the docs
# call it by name. Everything it used to do by hand — assemble a bundle-temp
# directory, hand-write manifest.json, stat file sizes, mero-sign, tar — is now
# the tool's job, and the manifest fields come from [package.metadata.calimero]
# in Cargo.toml (including the icon).
#
# THE SIGNING KEY IS GENERATED, NOT COMMITTED. A key file used to live at
# res/my-key.json in git, which meant anyone could sign a bundle that the
# registry and every node would accept as this package. That key is gone and
# revoked by deletion; this script mints a local one on first run and .gitignore
# keeps it out. Whoever signs a package's first published version owns it: the
# node derives ApplicationId from (package, signer), so a different key is a
# different app, not an upgrade. CI signs with the organization's MERO_SIGN_KEY
# secret instead — see .github/workflows/deploy-bundle.yml.
set -euo pipefail

cd "$(dirname "$0")"

# CI points this at the secret it wrote to a temp file; locally it defaults to
# the gitignored dev key.
KEY="${MERO_SIGN_KEY_FILE:-res/my-key.json}"

if [ ! -f "$KEY" ]; then
    if [ -n "${MERO_SIGN_KEY_FILE:-}" ]; then
        # An explicit path that does not exist is a configuration error, not an
        # invitation to mint a key CI would then publish under.
        echo "ERROR: MERO_SIGN_KEY_FILE points at a missing file: $KEY" >&2
        exit 1
    fi
    echo "==> no signing key at $KEY — generating a local dev key (gitignored)"
    cargo mero key generate --output "$KEY"
fi

# Local builds do not ask the registry for a number: this is the offline
# onboarding path, and the version of a bundle you install by hand is
# irrelevant. Releases go through deploy-bundle.yml, which resolves the real
# version from the registry and passes it as --app-version.
APP_VERSION="${APP_VERSION:-0.0.1}"

cargo mero bundle --key "$KEY" --app-version "$APP_VERSION" --print-output-path
