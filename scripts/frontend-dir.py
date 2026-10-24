#!/usr/bin/env python3
"""Print an app's `frontend-dir` from its logic/Cargo.toml, as a path from the repo root; print nothing when it ships none."""

import argparse
import os
import pathlib
import sys
import tomllib


def frontend_dir(root, app):
    logic = root / "apps" / app / "logic"
    with open(logic / "Cargo.toml", "rb") as f:
        calimero = tomllib.load(f).get("package", {}).get("metadata", {}).get("calimero", {})
    value = calimero.get("frontend-dir")
    if value is None:
        return ""
    if not isinstance(value, str) or not value:
        sys.exit(f"{app}: frontend-dir must be a non-empty string")
    return os.path.relpath(os.path.normpath(logic / value), root)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", nargs="?")
    parser.add_argument("--list", action="store_true", help="print every app that ships a frontend")
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    if args.list:
        for logic in sorted((args.root / "apps").glob("*/logic/Cargo.toml")):
            app = logic.parent.parent.name
            if frontend_dir(args.root, app):
                print(app)
    elif args.app:
        found = frontend_dir(args.root, args.app)
        if found:
            print(found)
    else:
        parser.error("give an app or --list")
