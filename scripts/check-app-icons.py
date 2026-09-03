#!/usr/bin/env python3
"""Assert every app's icon is real, and shaped for the places it is used.

WHY THIS EXISTS

`scripts/check-app-metadata.sh` validates the package id, the slug, the
frontend origin and the runtime floor. It never looked at `icon`, and every way
that field can be wrong is silent — the bundle publishes, CI is green, and the
only symptom is a wrong picture in the registry and in the desktop launcher.
Two of the three failure modes below were live in the fleet when this was
written:

  • `icon = "default"` — cargo-mero's placeholder. mero-issue-tracker 0.0.13 and
    mero-sheets 0.0.11 shipped the SAME 43,368-byte generic mark for months,
    each with its own real icon sitting unused in app/public/.

  • Transparent, pre-rounded corners on an icon that gets masked again
    downstream. kv-store's 192/512/apple-touch PNGs drew their own radius and
    were transparent outside it, while site.webmanifest advertised them
    `purpose: "any maskable"`. tauri-app's `ensure_app_launcher_icon` pulls the
    registry icon through sips/iconutil to write the per-app `.app` bundle in
    ~/Applications; iOS and Chrome's "install" mask too. Corners cut twice look
    notched, and the mark ends up smaller than its neighbours in the Dock.

  • A `sizes` in the manifest that disagrees with the file's real dimensions.
    Browsers pick an icon BY the declared size, so a lie here is chosen for the
    wrong slot and rescaled.

Stdlib only: this runs in the always-on `metadata` job, which has no npm
install and no pip install.
"""

import glob
import json
import os
import re
import struct
import sys
import zlib

REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

# An icon that gets masked downstream must be opaque out to the very edge, so
# the OS's own radius has something to cut. 250 rather than 255 leaves room for
# a rasteriser's edge sample.
OPAQUE = 250

# The registry icon is the source for the macOS `.app`; anything smaller gets
# upscaled into the Dock.
MIN_DIM = 512

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"::error::{msg}")


def png_dimensions(path: str) -> tuple[int, int] | None:
    """(width, height) from IHDR, or None if this is not a PNG."""
    with open(path, "rb") as fh:
        head = fh.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", head[16:24])


def corner_alpha(path: str) -> int | None:
    """The least alpha of the four corner pixels, or None if the PNG has no
    alpha channel (in which case it is opaque by construction).

    Decodes the image by hand — Pillow is not available in the metadata job and
    is not worth an install for four pixels. Only the 8-bit non-interlaced
    forms every generator in this repo emits are supported; anything else is
    reported rather than guessed at.
    """
    with open(path, "rb") as fh:
        data = fh.read()

    idat = b""
    ihdr = None
    pos = 8
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", chunk)
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length

    if ihdr is None:
        raise ValueError("no IHDR")
    width, height, depth, colour, _, _, interlace = ihdr
    if colour not in (4, 6):
        return None  # greyscale or truecolour with no alpha: opaque
    if depth != 8 or interlace:
        raise ValueError(f"unsupported PNG form (depth={depth}, interlace={interlace})")

    channels = 4 if colour == 6 else 2
    raw = zlib.decompress(idat)
    stride = width * channels

    # Unfilter. Every scanline depends on the one above it, so there is no
    # shortcut to the bottom two corners.
    out = bytearray(stride * height)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        filt = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        for x in range(stride):
            left = line[x - channels] if x >= channels else 0
            up = prev[x]
            upleft = prev[x - channels] if x >= channels else 0
            if filt == 1:
                line[x] = (line[x] + left) & 0xFF
            elif filt == 2:
                line[x] = (line[x] + up) & 0xFF
            elif filt == 3:
                line[x] = (line[x] + ((left + up) >> 1)) & 0xFF
            elif filt == 4:
                predictor = left + up - upleft
                pa, pb, pc = (
                    abs(predictor - left),
                    abs(predictor - up),
                    abs(predictor - upleft),
                )
                line[x] = (
                    line[x] + (left if pa <= pb and pa <= pc else up if pb <= pc else upleft)
                ) & 0xFF
        out[y * stride : (y + 1) * stride] = line
        prev = line

    ai = channels - 1

    def alpha(x: int, y: int) -> int:
        return out[(y * width + x) * channels + ai]

    # One pixel in from each corner: the outermost row can carry a rasteriser's
    # own anti-aliasing even on a square, full-bleed icon.
    return min(
        alpha(1, 1), alpha(width - 2, 1), alpha(1, height - 2), alpha(width - 2, height - 2)
    )


def check_registry_icon(app: str, manifest_path: str) -> None:
    """The `[package.metadata.calimero].icon` that becomes the registry icon and,
    downstream, the macOS launcher icon."""
    text = open(manifest_path).read()
    table = re.search(
        r"^\[package\.metadata\.calimero\]$(.*?)(?=^\[)", text, re.M | re.S
    )
    if not table:
        return  # a shared crate; check-app-metadata.sh owns that distinction
    found = re.search(r'^icon\s*=\s*"([^"]*)"', table.group(1), re.M)
    if not found:
        fail(f"{app}: [package.metadata.calimero].icon is missing — cargo mero bundle "
             f"refuses to run without it, and it fails at bundle time, on the release run")
        return

    icon = found.group(1)
    if icon == "default":
        hint = ""
        if os.path.isfile(os.path.join(REPO, "apps", app, "app/public/icon-512.png")):
            hint = " — and app/public/icon-512.png is right there"
        fail(f"{app}: icon = \"default\" is cargo-mero's placeholder, shared with every "
             f"other app that sets it{hint}")
        return

    path = os.path.normpath(os.path.join(os.path.dirname(manifest_path), icon))
    if not os.path.isfile(path):
        fail(f"{app}: icon '{icon}' does not resolve to a file")
        return

    rel = os.path.relpath(path, REPO)
    dims = png_dimensions(path)
    if dims is None:
        fail(f"{app}: icon {rel} is not a PNG")
        return
    width, height = dims
    if width < MIN_DIM or height < MIN_DIM:
        fail(f"{app}: icon {rel} is {width}x{height}; the registry icon feeds the macOS "
             f"launcher and must be at least {MIN_DIM}x{MIN_DIM}")
    if width != height:
        fail(f"{app}: icon {rel} is {width}x{height}; it must be square")

    try:
        alpha = corner_alpha(path)
    except ValueError as exc:
        fail(f"{app}: cannot read alpha from {rel}: {exc}")
        return
    if alpha is not None and alpha < OPAQUE:
        fail(f"{app}: icon {rel} has transparent corners (alpha={alpha}). It is masked "
             f"again by sips/iconutil for the macOS .app and by iOS — let the background "
             f"bleed to the edge and inset the mark instead")


def check_web_manifest(app: str) -> None:
    """The PWA manifest linked from index.html, wherever the app keeps it."""
    index = os.path.join(REPO, "apps", app, "app/index.html")
    if not os.path.isfile(index):
        return
    html = open(index).read()

    link = re.search(r'<link[^>]*rel="manifest"[^>]*href="([^"]+)"', html)
    if not link:
        return  # not every frontend is a PWA; scaffolding-e2e is a test harness

    public = os.path.join(REPO, "apps", app, "app/public")
    manifest = os.path.join(public, link.group(1).lstrip("/"))
    if not os.path.isfile(manifest):
        fail(f"{app}: index.html links {link.group(1)} but no such file under app/public/")
        return

    try:
        data = json.load(open(manifest))
    except json.JSONDecodeError as exc:
        fail(f"{app}: {os.path.relpath(manifest, REPO)} is not valid JSON: {exc}")
        return

    for entry in data.get("icons", []):
        src = entry.get("src", "")
        path = os.path.join(public, src.lstrip("/"))
        if not os.path.isfile(path):
            fail(f"{app}: manifest icon '{src}' does not exist under app/public/")
            continue
        if not src.endswith(".png"):
            continue  # an SVG has no pixels to check and no corners to mask

        rel = os.path.relpath(path, REPO)
        dims = png_dimensions(path)
        declared = entry.get("sizes", "")
        if dims and re.fullmatch(r"\d+x\d+", declared):
            want = tuple(int(n) for n in declared.split("x"))
            if want != dims:
                fail(f"{app}: manifest declares {src} as {declared} but it is "
                     f"{dims[0]}x{dims[1]} — a browser picks an icon BY the declared size")

        if "maskable" in entry.get("purpose", ""):
            try:
                alpha = corner_alpha(path)
            except ValueError as exc:
                fail(f"{app}: cannot read alpha from {rel}: {exc}")
                continue
            if alpha is not None and alpha < OPAQUE:
                fail(f"{app}: {rel} is declared `maskable` but has transparent corners "
                     f"(alpha={alpha}) — the platform's own mask cuts them a second time")

    # An `apple-touch-icon` is masked by iOS and composited on black, so it has
    # the same requirement even though it is not in the manifest.
    touch = re.search(r'<link[^>]*rel="apple-touch-icon"[^>]*href="([^"]+)"', html)
    if touch and touch.group(1).endswith(".png"):
        path = os.path.join(public, touch.group(1).lstrip("/"))
        if not os.path.isfile(path):
            fail(f"{app}: apple-touch-icon '{touch.group(1)}' does not exist under app/public/")
        else:
            try:
                alpha = corner_alpha(path)
            except ValueError as exc:
                fail(f"{app}: cannot read alpha from {touch.group(1)}: {exc}")
                alpha = None
            if alpha is not None and alpha < OPAQUE:
                fail(f"{app}: apple-touch-icon {touch.group(1)} has transparent corners "
                     f"(alpha={alpha}); iOS rounds it itself and fills the rest with black")

    # theme-color is declared twice — once for the browser chrome, once for the
    # installed app — and nothing reconciles them. mero-pass carried a leftover
    # #111111 in index.html against #090b10 in the manifest.
    html_theme = re.search(r'<meta[^>]*name="theme-color"[^>]*content="([^"]+)"', html)
    json_theme = data.get("theme_color")
    if html_theme and json_theme and html_theme.group(1).lower() != str(json_theme).lower():
        fail(f"{app}: theme-color is {html_theme.group(1)} in index.html but "
             f"{json_theme} in the web manifest")


def main() -> int:
    apps = sorted(
        p.split(os.sep)[-3] for p in glob.glob(os.path.join(REPO, "apps/*/logic/Cargo.toml"))
    )
    for app in apps:
        check_registry_icon(app, os.path.join(REPO, "apps", app, "logic/Cargo.toml"))
        check_web_manifest(app)
        print(f"  --  {app}")

    if failures:
        print(f"\napp icon check FAILED ({len(failures)} problem(s))")
        return 1
    print(f"\nall {len(apps)} apps' icons are real, square, and safe to mask")
    return 0


if __name__ == "__main__":
    sys.exit(main())
