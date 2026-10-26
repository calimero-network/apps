#!/usr/bin/env python3
"""Map each v1 bundle path the workflows install to the WASM it holds.

`merobox cloud port --wasm-map` reads this to turn `install_application` /
`create_context { service_name }` into uploads of the right contract. Built
from every app's `[package.metadata.calimero]` (package id and services), plus
the hand-built fixtures the workflows install. Paths use `{{env.APPS_WASM_DIR}}`
(the workspace's `target/wasm32-unknown-unknown/app-release`).
"""

import json
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIR = "{{env.APPS_WASM_DIR}}"


def wasm(crate: str) -> str:
    return f"{DIR}/{crate.replace('-', '_')}.wasm"


def main() -> None:
    out: dict[str, dict[str, str]] = {}
    for cargo in sorted(ROOT.glob("apps/*/logic/Cargo.toml")):
        data = tomllib.loads(cargo.read_text())
        pkg = data.get("package", {})
        crate = pkg.get("name")
        meta = pkg.get("metadata", {}).get("calimero", {})
        package = meta.get("package") or f"com.calimero.{cargo.parent.parent.name}"
        services = {s["name"]: wasm(s.get("crate", crate)) for s in meta.get("services", [])}
        entry = {"": wasm(crate), **services}
        out[f"dist/{package}.mpk"] = entry
    # Hand-built fixtures (see each app's build-multi-service-bundle.sh).
    multi = wasm("scaffolding-e2e")
    out["res/scaffolding-e2e-multi-0.1.0.mpk"] = {"": multi, "store-a": multi, "store-b": multi}
    out["/app/data/e2e-kv-store-multi-0.1.0.mpk"] = {"": multi, "store-a": multi, "store-b": multi}
    out["res/mero-standup-v1.mpk"] = {"": wasm("mero-standup-v1")}
    # Workflows that install a raw .wasm instead of a bundle.
    out["logic/res/mero_sign.wasm"] = {"": wasm("mero-sign")}
    out["../res/mero_stream.wasm"] = {"": wasm("mero-stream")}
    json.dump(out, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
