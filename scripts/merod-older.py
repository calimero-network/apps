#!/usr/bin/env python3
"""Print `true` when merod version A is older than B (0.11.0-rc.66 < 0.11.0-rc.69 < 0.11.0), else `false`."""

import re
import sys


def key(version):
    m = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?", version.strip())
    if not m:
        return None
    major, minor, patch, rc = m.groups()
    return (int(major), int(minor), int(patch), int(rc) if rc is not None else float("inf"))


if __name__ == "__main__":
    a, b = (key(v) for v in sys.argv[1:3])
    print("true" if a is not None and b is not None and a < b else "false")
