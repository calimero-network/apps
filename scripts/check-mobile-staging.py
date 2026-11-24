#!/usr/bin/env python3
"""A mobile app's store build never trusts Calimero Cloud's staging.

Staging's clusters run debug node images, whose memory the operator can read,
so trusting one is for testing only. A native app has no hostname a browser
checked (a served web page decides by its own, packages/connect), so the BUILD
decides: a staging build is a debug build made for it, and a store build is
always production. This fails when that is not what the code says:

- Android (Kotlin): `CloudEnvironment.STAGING` or `CloudPolicy.staging` only on
  a line that tests `BuildConfig.MERO_STAGING`, and a project whose build file
  defines `MERO_STAGING` pins it to `false` in its `release` build type.
- iOS (Swift): `CloudEnvironment.staging` / `CloudPolicy.staging` (or a bare
  `.staging`) only inside an `#if MERO_STAGING` block, and `project.yml` sets
  `MERO_STAGING` only under its `Staging` configuration.

Usage: check-mobile-staging.py [ROOT]   (default: the repository root)
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

KOTLIN_STAGING = re.compile(r"CloudEnvironment\.STAGING|CloudPolicy\.staging\b")
SWIFT_STAGING = re.compile(r"CloudEnvironment\.staging\b|CloudPolicy\.staging\b|(?<![\w.])\.staging\b")


def kotlin_problems(android: Path, root: Path) -> list[str]:
    problems: list[str] = []
    for path in sorted(android.rglob("*.kt")):
        if "/build/" in path.as_posix() or "/test/" in path.as_posix() or "/androidTest/" in path.as_posix():
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if KOTLIN_STAGING.search(line) and "BuildConfig.MERO_STAGING" not in line:
                problems.append(
                    f"{path.relative_to(root)}:{number}: staging trusted outside a BuildConfig.MERO_STAGING check"
                )
    for build in sorted(android.rglob("build.gradle.kts")):
        text = build.read_text(encoding="utf-8")
        if '"MERO_STAGING"' not in text:
            continue
        release = re.search(r"release\s*\{(?P<body>.*?)\n\s*\}", text, re.S)
        pinned = release and re.search(r'buildConfigField\(\s*"boolean",\s*"MERO_STAGING",\s*"false"\s*\)', release["body"])
        if not pinned:
            problems.append(
                f"{build.relative_to(root)}: defines MERO_STAGING but its release build type does not pin it to false"
            )
    return problems


def swift_problems(ios: Path, root: Path) -> list[str]:
    problems: list[str] = []
    for path in sorted(ios.rglob("*.swift")):
        posix = path.as_posix()
        if "/.build/" in posix or "Tests/" in posix or "UITests" in posix:
            continue
        stack: list[bool] = []  # one entry per open #if: whether it is the MERO_STAGING branch
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("#if"):
                stack.append(stripped.split("//")[0].strip() == "#if MERO_STAGING")
                continue
            if stripped.startswith("#elseif") or stripped.startswith("#else"):
                if stack:
                    stack[-1] = False
                continue
            if stripped.startswith("#endif"):
                if stack:
                    stack.pop()
                continue
            if stripped.startswith("//") or stripped.startswith("///"):
                continue
            if SWIFT_STAGING.search(line) and not any(stack):
                problems.append(f"{path.relative_to(root)}:{number}: staging trusted outside #if MERO_STAGING")
    for spec in sorted(ios.glob("project.yml")):
        lines = spec.read_text(encoding="utf-8").splitlines()
        for number, line in enumerate(lines, 1):
            if "MERO_STAGING" not in line or line.lstrip().startswith("#"):
                continue
            # The nearest less-indented key above it must be `Staging:`.
            indent = len(line) - len(line.lstrip())
            owner = next(
                (above.strip() for above in reversed(lines[: number - 1])
                 if above.strip() and not above.lstrip().startswith("#")
                 and len(above) - len(above.lstrip()) < indent),
                "",
            )
            if owner != "Staging:":
                problems.append(f"{spec.relative_to(root)}:{number}: MERO_STAGING set outside the Staging configuration")
    return problems


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    problems: list[str] = []
    for mobile in sorted((root / "apps").glob("*/mobile")):
        if (mobile / "android").is_dir():
            problems += kotlin_problems(mobile / "android", root)
        if (mobile / "ios").is_dir():
            problems += swift_problems(mobile / "ios", root)
    for problem in problems:
        print(f"::error::{problem}")
    if problems:
        print("A store build must never trust staging's debug images; see scripts/check-mobile-staging.py.")
        return 1
    print("every mobile app reaches staging only from a staging build")
    return 0


if __name__ == "__main__":
    sys.exit(main())
