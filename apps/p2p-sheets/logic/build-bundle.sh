#!/bin/bash
# Build the multi-service .mpk bundle from `studio.config.json`.
#
# Modes:
#   (default)   dev signing with a real Ed25519 key (current `mero-sign` has
#               no `--dev` flag). The key comes from $STUDIO_DEV_SIGNING_KEY
#               (a path to a mero-sign key JSON, or the key JSON inline); if
#               unset, a key is generated once at
#               ~/.calimero-studio/studio-dev-signing.key.json and reused, so
#               the signerId is stable across iterations. Re-runs with the
#               same appVersion are intentional — you reinstall via
#               `install-dev-application` on each iteration. Mirrors the
#               worker's registryPublish.js dev-key resolution.
#   --release   prod signing. Requires:
#                 - MERO_SIGN_KEY env var pointing to the prod signing key
#                 - studio.config.json appVersion bumped vs the previously
#                   published version (the registry rejects duplicates)
#
# Reads `../studio.config.json` for: appVersion, package, metadata, services.
# Service entries provide { id, name, crate } — `name` becomes both the
# manifest service name and the bundled wasm filename, `crate` is the Cargo
# package name (used to locate the wasm cargo emits as <crate_with_underscores>.wasm).

set -e
cd "$(dirname $0)"

if ! command -v jq > /dev/null; then
  echo "Error: jq is required (brew install jq / apt-get install jq)" >&2
  exit 1
fi

CONFIG="../studio.config.json"
if [[ ! -f "$CONFIG" ]]; then
  echo "Error: $CONFIG not found" >&2
  exit 1
fi

MODE="dev"
if [[ "${1:-}" == "--release" ]]; then
  MODE="release"
fi

APP_NAME=$(jq -r '.appName' "$CONFIG")
APP_VERSION=$(jq -r '.appVersion' "$CONFIG")
APP_PACKAGE=$(jq -r '.package' "$CONFIG")
APP_DISPLAY=$(jq -r '.metadata.name' "$CONFIG")
APP_DESC=$(jq -r '.metadata.description' "$CONFIG")
SERVICES_JSON=$(jq -c '.services' "$CONFIG")
SERVICE_COUNT=$(echo "$SERVICES_JSON" | jq 'length')

# ── appVersion: auto-bump from the App Registry ─────────────────────────────
# The registry rejects duplicate versions, so each publish needs a version
# greater than the last published one. Rather than hand-editing
# studio.config.json every time, fetch the latest published appVersion for this
# package and bump the patch. This runs in BOTH modes (mirrors mero-chat and
# mero-design's build-bundle.sh), because the studio Deploy path re-signs and
# pushes the *dev* bundle as-is (see registryPublish.js) — so if dev mode kept
# the config version, every publish would collide with the already-published
# version. The bump is keyed off the *registry's* latest, so repeated dev builds
# between publishes all resolve to the same next version (stable for
# install-dev-application reinstalls); it only advances once a publish lands.
# The GET is public (no secret — works in CI).
#   - APP_VERSION_OVERRIDE=x.y.z pins an explicit version (e.g. migrations).
#   - registry unreachable / package never published → keep the config version.
# Honor the worker's CALIMERO_REGISTRY_URL so the version auto-bump targets
# the same registry the publish goes to (diverging them causes 409 collisions).
REGISTRY_URL="${REGISTRY_URL:-${CALIMERO_REGISTRY_URL:-https://apps.calimero.network}}"
if [[ -n "${APP_VERSION_OVERRIDE:-}" ]]; then
  APP_VERSION="$APP_VERSION_OVERRIDE"
  echo "appVersion pinned via APP_VERSION_OVERRIDE: $APP_VERSION"
else
  # Parse every published appVersion into [major,minor,patch] ints, sort
  # numerically, take the max, bump the patch — all in jq (no `sort -V`, which
  # is unreliable on macOS BSD sort). Response is a flat array of bundle objects.
  LATEST=$(curl -fsS -m 15 "$REGISTRY_URL/api/v2/bundles?package=$APP_PACKAGE" 2>/dev/null \
    | jq -r '[ .[].appVersion // empty
               | split(".") | map(gsub("[^0-9]";"") | if . == "" then 0 else tonumber end) ]
             | sort | last // [] | map(tostring) | join(".")' 2>/dev/null)
  if [[ -n "$LATEST" && "$LATEST" != "null" ]]; then
    IFS='.' read -r MA MI PA <<< "$LATEST"
    APP_VERSION="${MA:-0}.${MI:-0}.$(( ${PA:-0} + 1 ))"
    echo "Auto-bumped appVersion from registry: $LATEST -> $APP_VERSION ($APP_PACKAGE)"
  else
    echo "Registry has no prior $APP_PACKAGE bundle (or unreachable) — using studio.config.json appVersion $APP_VERSION"
  fi
fi

# Persist the resolved version back to studio.config.json so every consumer
# that derives the .mpk filename from the config (e2e global-setup, the
# merobox smoke workflow, the worker's verify fallback) agrees with the
# bundle this build actually produces.
if [[ "$APP_VERSION" != "$(jq -r '.appVersion' "$CONFIG")" ]]; then
  CONFIG_TMP=$(mktemp "${TMPDIR:-/tmp}/studio-config.XXXXXX")
  jq --arg v "$APP_VERSION" '.appVersion = $v' "$CONFIG" > "$CONFIG_TMP" && mv "$CONFIG_TMP" "$CONFIG"
  echo "Persisted resolved appVersion to studio.config.json: $APP_VERSION"
fi

echo "Building $APP_DISPLAY ($APP_PACKAGE@$APP_VERSION) in $MODE mode — $SERVICE_COUNT services"

# Build each service via its build.sh — those scripts read the crate name
# from the matching service entry and copy the wasm into crates/<name>/res/<name>.wasm.
for i in $(seq 0 $((SERVICE_COUNT - 1))); do
  SVC_NAME=$(echo "$SERVICES_JSON" | jq -r ".[$i].name")
  SVC_CRATE=$(echo "$SERVICES_JSON" | jq -r ".[$i].crate")
  echo "Building $SVC_NAME service ($SVC_CRATE)..."
  (cd "crates/$SVC_NAME" && SVC_CRATE="$SVC_CRATE" SVC_NAME="$SVC_NAME" bash build.sh)
done

# Gather artifacts into bundle-temp. Per-service wasm/abi go under services/
# because the prod registry rejects any service whose wasm.path/abi.path is not
# "a safe relative path under services/" (e.g. services/<name>.wasm). The node
# accepts this too: core validate_artifact_path allows subdir slashes, and
# extract_bundle_file matches the full member path. The manifest paths and the
# tar member names below MUST stay identical (registryPublish.js re-tars the
# exact member list it reads from the dev .mpk).
mkdir -p res/bundle-temp/services
rm -f res/bundle-temp/*.wasm res/bundle-temp/*.json res/bundle-temp/services/*.wasm res/bundle-temp/services/*.json

SERVICE_ENTRIES=""
TAR_FILES="manifest.json"
for i in $(seq 0 $((SERVICE_COUNT - 1))); do
  SVC_NAME=$(echo "$SERVICES_JSON" | jq -r ".[$i].name")
  WASM_SRC="crates/$SVC_NAME/res/$SVC_NAME.wasm"
  ABI_SRC="crates/$SVC_NAME/res/abi.json"

  WASM_MEMBER="services/$SVC_NAME.wasm"
  ABI_MEMBER="services/$SVC_NAME-abi.json"
  cp "$WASM_SRC" "res/bundle-temp/$WASM_MEMBER"
  cp "$ABI_SRC" "res/bundle-temp/$ABI_MEMBER" 2>/dev/null || true

  WASM_SIZE=$(stat -f%z "$WASM_SRC" 2>/dev/null || stat -c%s "$WASM_SRC")
  ABI_SIZE=$(stat -f%z "$ABI_SRC" 2>/dev/null || stat -c%s "$ABI_SRC" 2>/dev/null || echo 0)

  ENTRY=$(jq -nc \
    --arg name "$SVC_NAME" \
    --arg wasm "$WASM_MEMBER" \
    --argjson wsize "$WASM_SIZE" \
    --arg abi "$ABI_MEMBER" \
    --argjson asize "$ABI_SIZE" \
    '{name:$name, wasm:{path:$wasm,size:$wsize,hash:null}, abi:{path:$abi,size:$asize,hash:null}}')

  if [[ -z "$SERVICE_ENTRIES" ]]; then
    SERVICE_ENTRIES="$ENTRY"
  else
    SERVICE_ENTRIES="$SERVICE_ENTRIES,$ENTRY"
  fi
  TAR_FILES="$TAR_FILES $WASM_MEMBER $ABI_MEMBER"
done

# Compose bundle manifest.json.
# links.frontend = the deployed app URL. The deploy step exports
# STUDIO_FRONTEND_URL (the deterministic Vercel git-branch alias) before
# calling this; plain local builds fall back to the dev server.
FRONTEND_URL="${STUDIO_FRONTEND_URL:-http://localhost:5173/}"
# metadata.author = shown as "Author" on the registry. Studio-built apps default
# to "Calimero Studio" (otherwise the registry shows no/unknown author). The
# deploy step exports STUDIO_AUTHOR (wins); standalone builds fall back to the
# config's metadata.author, then "Calimero Studio".
AUTHOR="${STUDIO_AUTHOR:-$(jq -r '.metadata.author // "Calimero Studio"' "$CONFIG")}"
# links.github = the workshop-apps branch holding this app's source, rendered as
# a "GitHub" link in registry package info. The deploy step exports
# STUDIO_GITHUB_URL (repo + deploy branch); omitted when unset so local/standalone
# builds don't emit a bogus link.
GITHUB_URL="${STUDIO_GITHUB_URL:-}"
jq -n \
  --arg version "1.0" \
  --arg pkg "$APP_PACKAGE" \
  --arg appVersion "$APP_VERSION" \
  --arg minRuntime "0.1.0" \
  --arg name "$APP_DISPLAY" \
  --arg desc "$APP_DESC" \
  --arg author "$AUTHOR" \
  --arg frontend "$FRONTEND_URL" \
  --arg github "$GITHUB_URL" \
  --argjson services "[$SERVICE_ENTRIES]" \
  '{version:$version, package:$pkg, appVersion:$appVersion, minRuntimeVersion:$minRuntime,
    metadata:{name:$name, description:$desc, author:$author},
    services:$services, migrations:[],
    links:({frontend:$frontend} + (if $github != "" then {github:$github} else {} end))}' \
  > res/bundle-temp/manifest.json

# Sign per mode.
if [[ "$MODE" == "release" ]]; then
  if [[ -z "${MERO_SIGN_KEY:-}" ]]; then
    echo "Error: --release requires MERO_SIGN_KEY pointing to the prod signing key" >&2
    exit 1
  fi
  if ! command -v mero-sign > /dev/null; then
    echo "Error: mero-sign not on PATH (install from calimero-network/core/tools/mero-sign)" >&2
    exit 1
  fi
  mero-sign sign --key "$MERO_SIGN_KEY" res/bundle-temp/manifest.json
else
  if command -v mero-sign > /dev/null; then
    # Resolve the dev key: $STUDIO_DEV_SIGNING_KEY (path or inline JSON), else
    # a generated-once key reused across builds for a stable signerId.
    DEV_KEY_RAW="${STUDIO_DEV_SIGNING_KEY:-}"
    DEV_KEY_PATH=""
    if [[ -n "$DEV_KEY_RAW" ]]; then
      if [[ "${DEV_KEY_RAW#\{}" != "$DEV_KEY_RAW" ]]; then
        # Inline key JSON — materialize to a temp file.
        DEV_KEY_PATH="$(mktemp -t studio-dev-key.XXXXXX).json"
        printf '%s' "$DEV_KEY_RAW" > "$DEV_KEY_PATH"
      elif [[ -f "$DEV_KEY_RAW" ]]; then
        DEV_KEY_PATH="$DEV_KEY_RAW"
      else
        echo "Error: STUDIO_DEV_SIGNING_KEY set but is neither inline JSON nor an existing file: $DEV_KEY_RAW" >&2
        exit 1
      fi
    else
      DEV_KEY_PATH="$HOME/.calimero-studio/studio-dev-signing.key.json"
      if [[ ! -f "$DEV_KEY_PATH" ]]; then
        mkdir -p "$(dirname "$DEV_KEY_PATH")"
        mero-sign generate-key --output "$DEV_KEY_PATH"
        echo "Generated dev signing key at $DEV_KEY_PATH (reused on future builds)"
      fi
    fi
    mero-sign sign --key "$DEV_KEY_PATH" res/bundle-temp/manifest.json
  else
    echo "Warning: mero-sign not found, bundle will be unsigned" >&2
  fi
fi

# Tar into the .mpk. Filename uses appName (clean) — package is in the manifest.
cd res/bundle-temp
tar -czf "../$APP_NAME-$APP_VERSION.mpk" $TAR_FILES

cd ..
echo "Bundle created: res/$APP_NAME-$APP_VERSION.mpk"
