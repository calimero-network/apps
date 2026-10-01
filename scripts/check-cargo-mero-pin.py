#!/usr/bin/env python3
"""apps/mero-docs/scripts/setup-cargo-mero.sh must pin the core tag the workspace SDK is on.

The script carries its own release and checksums, and fleet-bump does not rewrite it.
"""

import pathlib
import subprocess
import sys
import tomllib

ROOT = pathlib.Path(__file__).resolve().parents[1]


def main(cargo_toml: pathlib.Path, script: pathlib.Path) -> int:
    tag = tomllib.loads(cargo_toml.read_text())["workspace"]["dependencies"]["calimero-sdk"]["tag"]
    release = subprocess.run(
        ["bash", str(script), "--print-release"], capture_output=True, text=True, check=True
    ).stdout.strip()
    if release != tag:
        print(
            f"{script.name} pins cargo-mero {release} but {cargo_toml.name} pins core {tag}. "
            "Bump RELEASE and the three checksums together.",
            file=sys.stderr,
        )
        return 1
    print(f"{script.name} pins {release}, matching the workspace SDK")
    return 0


if __name__ == "__main__":
    args = [pathlib.Path(a) for a in sys.argv[1:]]
    sys.exit(
        main(*args)
        if args
        else main(ROOT / "Cargo.toml", ROOT / "apps/mero-docs/scripts/setup-cargo-mero.sh")
    )
