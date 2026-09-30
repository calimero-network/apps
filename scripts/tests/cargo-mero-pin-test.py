#!/usr/bin/env python3
"""check-cargo-mero-pin.py fails on a drifted release and passes on a matching one."""

import pathlib
import subprocess
import sys
import tempfile

CHECK = pathlib.Path(__file__).resolve().parents[1] / "check-cargo-mero-pin.py"


def run(sdk_tag: str, script_release: str) -> subprocess.CompletedProcess:
    with tempfile.TemporaryDirectory() as d:
        cargo = pathlib.Path(d, "Cargo.toml")
        cargo.write_text(f'[workspace.dependencies]\ncalimero-sdk = {{ tag = "{sdk_tag}" }}\n')
        script = pathlib.Path(d, "setup.sh")
        script.write_text(f'echo {script_release}\n')
        return subprocess.run(
            [sys.executable, str(CHECK), str(cargo), str(script)], capture_output=True, text=True
        )


drift = run("0.11.0-rc.62", "0.11.0-rc.61")
assert drift.returncode == 1, drift
assert "rc.61" in drift.stderr and "rc.62" in drift.stderr, drift.stderr

match = run("0.11.0-rc.62", "0.11.0-rc.62")
assert match.returncode == 0, match

print("ok")
