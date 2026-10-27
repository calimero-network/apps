#!/usr/bin/env python3
"""Build every contract with `cargo mero build` into target/cloud-v2-wasm/.

merod-v2 reads what a node acts on from the ABI a bundle embeds: which methods
are event handlers (`#[app::handler]`), xcall entry points (`#[app::xcall]`)
and TEE timers (`#[app::tee(every = "..")]`). A plain
`cargo build --target wasm32-unknown-unknown` embeds no ABI, so the ported
workflows run against these builds instead (`scripts/cloud-v2-workflows.py`
defaults `APPS_WASM_DIR` here).

Usage: scripts/build-cloud-v2-wasm.py [crate ...]   (default: every cdylib under apps/)
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "target" / "cloud-v2-wasm"


def strip_debug(path: Path) -> None:
    """Drop a module's debug custom sections (`.debug*`, `name`), keeping the
    rest (the embedded ABI among them). A `--profiling` build keeps them."""
    data = path.read_bytes()
    out, i = bytearray(data[:8]), 8

    def leb(at: int) -> tuple[int, int]:
        value = shift = 0
        while True:
            b = data[at]
            at += 1
            value |= (b & 0x7F) << shift
            shift += 7
            if b < 0x80:
                return value, at

    while i < len(data):
        sid = data[i]
        size, body = leb(i + 1)
        end = body + size
        keep = True
        if sid == 0:
            n, name_at = leb(body)
            name = data[name_at : name_at + n].decode("utf-8", "replace")
            keep = not (name.startswith(".debug") or name == "name")
        if keep:
            out += data[i:end]
        i = end
    path.write_bytes(bytes(out))


def contracts() -> list[dict]:
    meta = json.loads(
        subprocess.check_output(
            ["cargo", "metadata", "--no-deps", "--format-version", "1"], cwd=ROOT
        )
    )
    apps = ROOT / "apps"
    return [
        p
        for p in meta["packages"]
        if Path(p["manifest_path"]).is_relative_to(apps)
        and any("cdylib" in t["crate_types"] for t in p["targets"])
    ]


def main() -> int:
    wanted = set(sys.argv[1:])
    OUT.mkdir(parents=True, exist_ok=True)
    failed = []
    for p in contracts():
        if wanted and p["name"] not in wanted:
            continue
        manifest = Path(p["manifest_path"])
        name = p["name"].replace("-", "_")
        print(f"building {p['name']}", flush=True)
        cmd = ["cargo", "mero", "build", "--manifest-path", str(manifest)]
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0 and "wasm-validator" in r.stderr:
            # The bundled wasm-opt refuses some contracts' features; the size
            # pass is only an optimization, the ABI is embedded either way.
            print(f"  {p['name']}: wasm-opt refused it, building without it", flush=True)
            r = subprocess.run(cmd + ["--profiling"], cwd=ROOT, capture_output=True, text=True)
            if r.returncode == 0:
                strip_debug(manifest.parent / "res" / f"{name}.wasm")
        built = manifest.parent / "res" / f"{name}.wasm"
        if r.returncode != 0 or not built.exists():
            print(r.stderr[-2000:], file=sys.stderr)
            failed.append(p["name"])
            continue
        shutil.copy2(built, OUT / f"{name}.wasm")
    if failed:
        print(f"failed: {', '.join(failed)}", file=sys.stderr)
        return 1
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
