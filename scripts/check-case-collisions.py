#!/usr/bin/env python3
"""Fail when two tracked source modules differ only by case (`Home.tsx` next to `home.ts`).
On a case-insensitive filesystem (macOS, Windows) an extensionless import picks the wrong one."""

import subprocess
import sys
from collections import defaultdict

tracked = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout.decode().split("\0")
MODULE = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".json")  # what an extensionless import resolves
by_stem = defaultdict(list)
for path in filter(None, tracked):
    if not path.endswith(MODULE):
        continue
    directory, _, name = path.rpartition("/")
    stem = name.rsplit(".", 1)[0]
    by_stem[(directory, stem.lower())].append(path)

clashes = [paths for paths in by_stem.values() if len({p.rpartition("/")[2].rsplit(".", 1)[0] for p in paths}) > 1]
for paths in clashes:
    print("names that differ only by case:", ", ".join(paths))
if clashes:
    sys.exit(1)
print(f"check-case-collisions: no source modules differ only by case.")
