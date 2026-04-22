#!/usr/bin/env bash
set -euo pipefail

VERSION="0.10.1-rc.29"
REPO="calimero-network/core"
INSTALL_DIR="/usr/local/bin"
TMP_DIR="$(mktemp -d)"

# ── Detect platform ────────────────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64)  PLATFORM="aarch64-apple-darwin" ;;
      x86_64) PLATFORM="x86_64-apple-darwin" ;;
      *)      echo "Unsupported Mac arch: $ARCH"; exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      aarch64) PLATFORM="aarch64-unknown-linux-gnu" ;;
      x86_64)  PLATFORM="x86_64-unknown-linux-gnu" ;;
      *)       echo "Unsupported Linux arch: $ARCH"; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS"; exit 1 ;;
esac

BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"

echo "Installing merod + meroctl ${VERSION} for ${PLATFORM}"
echo ""

# ── Download & extract ─────────────────────────────────────────────────────

download_and_install() {
  local binary="$1"
  local tarball="${binary}_${PLATFORM}.tar.gz"
  local url="${BASE_URL}/${tarball}"

  echo "→ Downloading ${tarball}..."
  curl -fsSL "$url" -o "${TMP_DIR}/${tarball}"

  echo "  Extracting..."
  tar -xzf "${TMP_DIR}/${tarball}" -C "${TMP_DIR}"

  echo "  Installing to ${INSTALL_DIR}/${binary}..."
  sudo mv "${TMP_DIR}/${binary}" "${INSTALL_DIR}/${binary}"
  sudo chmod +x "${INSTALL_DIR}/${binary}"

  # Remove macOS quarantine so Gatekeeper doesn't block it
  if [[ "$OS" == "Darwin" ]]; then
    xattr -d com.apple.quarantine "${INSTALL_DIR}/${binary}" 2>/dev/null || true
    xattr -c "${INSTALL_DIR}/${binary}" 2>/dev/null || true
  fi

  echo "  ✓ ${binary} installed"
  echo ""
}

download_and_install "merod"
download_and_install "meroctl"

# ── Cleanup ────────────────────────────────────────────────────────────────

rm -rf "$TMP_DIR"

# ── Verify ─────────────────────────────────────────────────────────────────

echo "Versions:"
merod   --version 2>/dev/null && echo "" || echo "  merod   — could not run (check PATH or Gatekeeper)"
meroctl --version 2>/dev/null && echo "" || echo "  meroctl — could not run (check PATH or Gatekeeper)"

echo "Done."
