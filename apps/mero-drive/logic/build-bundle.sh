#!/bin/bash
# Build the two services, gather their artifacts, and package them as a
# single signed `.mpk` bundle. This mirrors the battleships multi-service
# pattern: one manifest with a `services` array, each service carrying its
# own wasm + abi, signed via `mero-sign` from the sibling core checkout.

set -e
cd "$(dirname $0)"

# Bundle/manifest version. Single source of truth: the workspace
# [workspace.package] version in this dir's Cargo.toml (crates inherit it via
# version.workspace = true). Override with APP_VERSION_OVERRIDE to cut a
# migration-target bundle without bumping the workspace. DOCS_FEATURES (read
# by crates/docs/build.sh) selects the docs schema variant.
APP_VERSION="${APP_VERSION_OVERRIDE:-$(grep '^version' Cargo.toml | head -1 | sed 's/.*"\(.*\)"/\1/')}"
# Dev install dedups by package name, so a migration-target bundle must carry a
# DISTINCT package to install as a separate application (override here).
PACKAGE="${PACKAGE_OVERRIDE:-com.calimero.mero-drive-docs}"

echo "Building registry service..."
(cd crates/registry && bash build.sh)
echo "Building docs service..."
(cd crates/docs && bash build.sh)

# Service artifacts live under a `services/` directory: the registry/publish
# validator requires each service's wasm.path / abi.path to be a safe relative
# path UNDER services/ (e.g. services/registry.wasm). merod resolves the
# manifest path as-given against the bundle, so the tar layout and the manifest
# paths must agree — both use the services/ prefix below.
rm -rf res/bundle-temp
mkdir -p res/bundle-temp/services

cp crates/registry/res/registry.wasm res/bundle-temp/services/
cp crates/docs/res/docs.wasm         res/bundle-temp/services/
cp crates/registry/res/abi.json      res/bundle-temp/services/registry-abi.json
cp crates/docs/res/abi.json          res/bundle-temp/services/docs-abi.json

# Embed each service's state schema as the `calimero_abi_v1` wasm section: core
# resolves the migration plan ONLY from that section, so a bundle without it
# swaps bytecode code-only and panics on first read. `mero-abi state` reads the
# SIBLING crates/<svc>/res/abi.json (not the wasm), so it must run against the
# crate res dir; `embed` then writes the section into the bundle-temp copy in
# place. Must precede size() below, since embedding grows the file.
if [ -n "${MERO_ABI_TOOL:-}" ]; then
    for svc in registry docs; do
        SCHEMA=$(mktemp)
        "$MERO_ABI_TOOL" state "crates/${svc}/res/${svc}.wasm" -o "$SCHEMA"
        "$MERO_ABI_TOOL" embed "res/bundle-temp/services/${svc}.wasm" "$SCHEMA"
        rm -f "$SCHEMA"
    done
elif [ "${ALLOW_UNEMBEDDED_BUNDLE:-}" = "1" ]; then
    echo "warning: MERO_ABI_TOOL not set - bundle will LACK the embedded calimero_abi_v1 section; migrations will NOT run"
else
    echo "error: MERO_ABI_TOOL is not set. A bundle without the embedded calimero_abi_v1" >&2
    echo "  section cannot migrate: upgrades swap bytecode code-only and panic on first read." >&2
    echo "  Point MERO_ABI_TOOL at core's mero-abi binary (cargo build -p mero-abi --release)," >&2
    echo "  or set ALLOW_UNEMBEDDED_BUNDLE=1 for a throwaway bundle that will never migrate." >&2
    exit 1
fi

size() {
    stat -f%z "$1" 2>/dev/null || stat -c%s "$1"
}
# Measure the bundle-temp wasm copies: embedding above grew them, and the
# manifest must not record stale (pre-embed) sizes.
REG_WASM_SIZE=$(size res/bundle-temp/services/registry.wasm)
DOC_WASM_SIZE=$(size res/bundle-temp/services/docs.wasm)
REG_ABI_SIZE=$(size crates/registry/res/abi.json)
DOC_ABI_SIZE=$(size crates/docs/res/abi.json)

cat > res/bundle-temp/manifest.json <<EOF
{
  "version": "1.0",
  "package": "${PACKAGE}",
  "appVersion": "${APP_VERSION}",
  "minRuntimeVersion": "0.1.0",
  "metadata": {
    "name": "Mero Drive Docs",
    "description": "Namespace-based document workspace — registry + docs multi-service bundle.",
    "author": "Calimero"
  },
  "services": [
    {
      "name": "registry",
      "wasm": { "path": "services/registry.wasm", "size": ${REG_WASM_SIZE}, "hash": null },
      "abi":  { "path": "services/registry-abi.json", "size": ${REG_ABI_SIZE}, "hash": null }
    },
    {
      "name": "docs",
      "wasm": { "path": "services/docs.wasm", "size": ${DOC_WASM_SIZE}, "hash": null },
      "abi":  { "path": "services/docs-abi.json", "size": ${DOC_ABI_SIZE}, "hash": null }
    }
  ],
  "migrations": [],
  "links": {
    "frontend": "https://mero-drive.vercel.app/"
  }
}
EOF

# Sign the manifest via the sibling core workspace's mero-sign tool. The
# path is relative to this repo sitting next to core/ in the parent dir,
# same layout battleships uses. --dev signs with the well-known development
# key (core removed the committed test key); dev-signed bundles cannot be
# published to the registry, which is fine for local/e2e installs.
if [ -d "../../core" ]; then
    cargo run --manifest-path ../../core/Cargo.toml -p mero-sign --quiet -- \
        sign res/bundle-temp/manifest.json --dev
else
    echo "warning: ../../core not found — bundle will be UNSIGNED (dev use only)"
fi

# Package as .mpk (tar.gz). Bundle into dist/ (committed per project
# convention — see .gitignore: `!logic/dist/`).
mkdir -p dist
# Unversioned filename: the version lives only in the manifest (appVersion,
# from logic/Cargo.toml [workspace.package]) — keeping it out of the filename
# means merobox workflows + e2e-up.ts never hardcode a version, so a version
# bump touches exactly one place. (A migration-target bundle uses
# PACKAGE_OVERRIDE for a distinct name.)
BUNDLE="dist/${PACKAGE}.mpk"
cd res/bundle-temp
# COPYFILE_DISABLE stops macOS tar from injecting AppleDouble `._*` entries.
COPYFILE_DISABLE=1 tar -czf "../../${BUNDLE}" \
    manifest.json \
    services/registry.wasm services/registry-abi.json \
    services/docs.wasm     services/docs-abi.json
cd ../..

echo "Bundle created: ${BUNDLE}"
