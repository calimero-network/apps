#!/usr/bin/env python3
"""merod-older.py orders rc tags numerically and a release after its rcs."""

import pathlib
import subprocess
import sys

OLDER = pathlib.Path(__file__).resolve().parents[1] / "merod-older.py"


def older(a, b):
    return subprocess.run([sys.executable, str(OLDER), a, b], capture_output=True, text=True, check=True).stdout.strip()


assert older("0.11.0-rc.66", "0.11.0-rc.69") == "true"
assert older("0.11.0-rc.9", "0.11.0-rc.10") == "true"
assert older("0.11.0-rc.69", "0.11.0-rc.66") == "false"
assert older("0.11.0-rc.69", "0.11.0-rc.69") == "false"
assert older("0.11.0", "0.11.0-rc.69") == "false"
assert older("0.11.0-rc.69", "0.11.0") == "true"
assert older("0.10.4", "0.11.0-rc.1") == "true"
assert older("", "0.11.0-rc.69") == "false"
assert older("null", "0.11.0-rc.69") == "false"
print("ok")
