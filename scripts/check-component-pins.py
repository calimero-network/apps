#!/usr/bin/env python3
"""Every component app and tool pins core at `component-core-tag`.

A component app is a standalone crate (its own `[workspace]`), so it cannot
inherit `[workspace.dependencies]` the way a v1 app inherits `calimero-sdk`:
each one names core in its own Cargo.toml. This is what keeps "a core release is
ONE edit" true for them: bump `component-core-tag` in the root Cargo.toml and
this check lists every crate still on the old tag.

Checked, for `apps/*/logic/Cargo.toml` that depend on `calimero-app-sdk` and for
`tools/component-bundle/Cargo.toml`:

* every dependency from github.com/calimero-network/core (in any dependency
  table) names `tag = "<component-core-tag>"`: no branch, no rev, no path;
* `min-runtime-version` in `[package.metadata.calimero]` equals
  `component-min-runtime-version`;
* the crate is its own workspace root (`[workspace]`) and the root Cargo.toml
  excludes it (apps only), or cargo refuses both workspaces.

Usage: scripts/check-component-pins.py [REPO_ROOT]
"""

from __future__ import annotations

import sys
import tomllib
from pathlib import Path

CORE = "github.com/calimero-network/core"


def dependency_tables(manifest: dict) -> list[tuple[str, dict]]:
    """(label, table) for every dependency table, target-specific ones included."""
    out = []
    for key in ("dependencies", "dev-dependencies", "build-dependencies"):
        if key in manifest:
            out.append((key, manifest[key]))
    for target, body in manifest.get("target", {}).items():
        for key in ("dependencies", "dev-dependencies", "build-dependencies"):
            if key in body:
                out.append((f"target.'{target}'.{key}", body[key]))
    return out


def check_crate(path: Path, tag: str, runtime: str | None, root: Path, excluded: set[str]) -> list[str]:
    errors = []
    manifest = tomllib.loads(path.read_text())
    rel = path.relative_to(root)
    for label, table in dependency_tables(manifest):
        for name, spec in table.items():
            if not isinstance(spec, dict):
                continue
            git = spec.get("git", "")
            if CORE not in git and not (name.startswith("calimero-") and "path" in spec):
                continue
            if "path" in spec:
                errors.append(f"{rel}: [{label}] {name} is a path dependency; pin core by tag = \"{tag}\"")
            elif spec.get("tag") != tag:
                got = spec.get("tag") or spec.get("branch") or spec.get("rev") or "nothing"
                errors.append(f"{rel}: [{label}] {name} pins {got}, expected tag = \"{tag}\"")
    if "workspace" not in manifest:
        errors.append(f"{rel}: not its own workspace root; add an empty [workspace] table")
    if runtime is not None:
        meta = manifest.get("package", {}).get("metadata", {}).get("calimero", {})
        got = meta.get("min-runtime-version")
        if got != runtime:
            errors.append(f"{rel}: min-runtime-version is {got!r}, expected {runtime!r}")
        crate_dir = str(path.parent.relative_to(root))
        if crate_dir not in excluded:
            errors.append(f"{rel}: the root Cargo.toml does not exclude {crate_dir} (add it to [workspace].exclude)")
    return errors


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent)
    workspace = tomllib.loads((root / "Cargo.toml").read_text())
    values = workspace.get("workspace", {}).get("metadata", {}).get("mero-apps", {})
    tag = values.get("component-core-tag")
    runtime = values.get("component-min-runtime-version")
    if not tag or not runtime:
        print("root Cargo.toml: [workspace.metadata.mero-apps] needs component-core-tag and component-min-runtime-version")
        return 1
    excluded = {str(Path(p)) for p in workspace.get("workspace", {}).get("exclude", [])}

    errors: list[str] = []
    apps = sorted(
        p for p in root.glob("apps/*/logic/Cargo.toml")
        if any(line.split("=")[0].strip() == "calimero-app-sdk" for line in p.read_text().splitlines())
    )
    for manifest in apps:
        errors += check_crate(manifest, tag, runtime, root, excluded)
    tool = root / "tools/component-bundle/Cargo.toml"
    if tool.exists():
        errors += check_crate(tool, tag, None, root, excluded)

    for e in errors:
        print(f"::error::{e}")
    if errors:
        return 1
    print(f"component crates pin core {tag}: {', '.join(str(p.parent.parent.name) for p in apps) or 'no apps yet'}, tools/component-bundle")
    return 0


if __name__ == "__main__":
    sys.exit(main())
