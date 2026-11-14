#!/usr/bin/env python3
"""Every component app pins core at `component-core-tag`.

A component app is a standalone crate (its own `[workspace]`), so it cannot
inherit `[workspace.dependencies]` the way a v1 app inherits `calimero-sdk`:
each one names core in its own Cargo.toml. This is what keeps "a core release is
ONE edit" true for them: bump `component-core-tag` in the root Cargo.toml and
this check lists every crate still on the old tag.

Checked, for `apps/*/logic/Cargo.toml` that depend on `calimero-sdk` from core's
git (a v1 app inherits its `calimero-sdk` from the root workspace instead):

* no dependency still names `calimero-app-sdk`, the name core renamed to
  `calimero-sdk` in 1.0.0-rc.9 (kept there only as an alias);

* every dependency from github.com/calimero-network/core (in any dependency
  table) names `tag = "<component-core-tag>"`: no branch, no rev, no path;
* `min-runtime-version` in `[package.metadata.calimero]` equals
  `component-min-runtime-version`;
* the crate is its own workspace root (`[workspace]`) and the root Cargo.toml
  excludes it, or cargo refuses both workspaces.

The tool that builds and packs them is core's released `meroctl`, pinned by
scripts/install-meroctl.sh, not a crate here: it has no core dependency to check.

Usage: scripts/check-component-pins.py [REPO_ROOT]
"""

from __future__ import annotations

import sys
import tomllib
from pathlib import Path

CORE = "github.com/calimero-network/core"
# Core 1.0.0-rc.9 (core#4842) renamed the component SDK; the old names are aliases.
OLD_NAMES = {"calimero-app-sdk": "calimero-sdk", "calimero-app-sdk-macros": "calimero-sdk-macros"}


def is_component_app(manifest: dict) -> bool:
    """Depends on `calimero-sdk` (or the old `calimero-app-sdk`) from core's git."""
    deps = manifest.get("dependencies", {})
    for name in ("calimero-sdk", "calimero-app-sdk"):
        spec = deps.get(name)
        if isinstance(spec, dict) and CORE in spec.get("git", ""):
            return True
    return False


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


def check_crate(path: Path, tag: str, runtime: str, root: Path, excluded: set[str]) -> list[str]:
    errors = []
    manifest = tomllib.loads(path.read_text())
    rel = path.relative_to(root)
    for label, table in dependency_tables(manifest):
        for name, spec in table.items():
            if name in OLD_NAMES:
                errors.append(f"{rel}: [{label}] {name} is the old name; depend on {OLD_NAMES[name]} instead")
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
        if is_component_app(tomllib.loads(p.read_text()))
    )
    for manifest in apps:
        errors += check_crate(manifest, tag, runtime, root, excluded)

    for e in errors:
        print(f"::error::{e}")
    if errors:
        return 1
    print(f"component crates pin core {tag}: {', '.join(str(p.parent.parent.name) for p in apps) or 'no apps yet'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
