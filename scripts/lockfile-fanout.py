#!/usr/bin/env python3
"""Decide whether a lockfile change affects apps beyond the ones that changed.

WHY THIS EXISTS

ci.yml is path-filtered per app, but `Cargo.lock` and `pnpm-lock.yaml` were flat
booleans in the `shared` / `js_deps` filters, and either one firing covered
EVERY app. Both files are rewritten whenever an app is added, renamed, or
removed — so every migration PR paid for the full WASM + browser + merobox
matrix to prove that nine untouched apps still worked.

The filters asked "did the lockfile change". The question that actually justifies
the fan-out is "did it change for SOMEONE ELSE". This script answers that one.

WHAT COUNTS AS AFFECTING EVERYONE

Cargo.lock resolves ONE version per package for the whole workspace, so a
dependency moving really does change every contract's bytes. Workspace members
are told apart from dependencies by a rule cargo itself maintains: a member has
no `source` key, because it is a path, not something fetched. So an app arriving
or being renamed only adds and removes source-less entries, while an SDK bump
changes a *sourced* package's version.

pnpm-lock.yaml records resolution PER IMPORTER, so a new importer block cannot
change what another app resolves. Only two things can: a change inside another
importer's own block, or a version disappearing from the shared `packages:` /
`snapshots:` maps (a bump removes the old line; a pure addition removes nothing).
`catalogs:`, `settings:` and `overrides:` are workspace-wide by definition.

USAGE

  lockfile-fanout.py cargo --base-file A --head-file B
  lockfile-fanout.py pnpm  --base-file A --head-file B
  lockfile-fanout.py {cargo,pnpm} --base REV --head REV [--path FILE]

Prints either the single word `all`, or zero or more paths whose apps this
change reaches (for pnpm: the importer directories), one per line. Empty output
means "no app beyond those whose files already changed".

Python, not bash, on purpose: this compares parsed blocks, and the repo has to
be able to run its own CI logic on macOS's bash 3.2 (no associative arrays).
"""

from __future__ import annotations

import argparse
import subprocess
import sys

ALL = "all"


# ── reading a revision ──────────────────────────────────────────────────────


def read_rev(rev: str, path: str) -> str | None:
    """The file at a revision, or None when it isn't there / isn't reachable."""
    try:
        out = subprocess.run(
            ["git", "show", f"{rev}:{path}"],
            capture_output=True,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    return out.stdout.decode("utf-8", "replace")


# ── Cargo.lock ──────────────────────────────────────────────────────────────


def cargo_dep_versions(text: str) -> dict[str, set[str]]:
    """{package: {versions}} for DEPENDENCIES only — entries with a `source`.

    Workspace members are skipped: they carry no `source`, and an app's own
    entry appearing, vanishing or being renamed says nothing about any other
    app's resolved bytes.
    """
    deps: dict[str, set[str]] = {}
    name = version = None
    sourced = False

    def flush() -> None:
        if name and version and sourced:
            deps.setdefault(name, set()).add(version)

    for raw in text.splitlines():
        line = raw.strip()
        if line == "[[package]]":
            flush()
            name = version = None
            sourced = False
        elif line.startswith("name = "):
            name = line[len("name = ") :].strip().strip('"')
        elif line.startswith("version = "):
            version = line[len("version = ") :].strip().strip('"')
        elif line.startswith("source = "):
            sourced = True
    flush()
    return deps


def cargo_fanout(base: str, head: str) -> list[str]:
    before = cargo_dep_versions(base)
    after = cargo_dep_versions(head)
    for pkg, versions in before.items():
        # Gone entirely, or a version we used to pin is no longer pinned.
        if versions - after.get(pkg, set()):
            return [ALL]
    return []


# ── pnpm-lock.yaml ──────────────────────────────────────────────────────────

# Sections small enough, and global enough, that any difference at all is a
# workspace-wide change: the lockfile format itself, install settings, and
# forced overrides.
PNPM_GLOBAL_SECTIONS = ("lockfileVersion", "settings", "overrides")
# Shared maps where an ADDITION is harmless but a REMOVAL or REWRITE is not.
#
# `catalogs:` belongs here and not above: pnpm records only the catalog entries
# some importer actually uses, so the FIRST app to consume an existing catalog
# entry adds a block without changing anything for anyone. A version genuinely
# moving removes the old line, which the removal test below catches.
#
# `snapshots:` earns its place from the case that motivated all of this: adding
# an app that uses Sass rewrote every importer's vite key from
# `vite@6.4.3(@types/node@22.20.1)` to `...(sass@1.103.1)`. That IS a change to
# what every other app resolves, and the fan-out for it is correct.
PNPM_SHARED_MAPS = ("catalogs", "packages", "snapshots")


def pnpm_sections(text: str) -> dict[str, list[str]]:
    """Split the lockfile into top-level sections, keyed by their 0-indent key."""
    sections: dict[str, list[str]] = {}
    current = ""
    for line in text.splitlines():
        if line and not line[0].isspace():
            current = line.split(":", 1)[0].strip()
            sections.setdefault(current, []).append(line)
        elif current:
            sections[current].append(line)
    return sections


def pnpm_importers(section_lines: list[str]) -> dict[str, list[str]]:
    """{importer path: its block} out of the `importers:` section."""
    importers: dict[str, list[str]] = {}
    current = None
    for line in section_lines:
        if not line.strip():
            continue
        stripped = line.lstrip()
        indent = len(line) - len(stripped)
        if indent == 0:
            continue  # the `importers:` key itself
        if indent == 2 and stripped.endswith(":"):
            current = stripped[:-1].strip().strip("'\"")
            importers.setdefault(current, [])
        elif current is not None:
            importers[current].append(line)
    return importers


def pnpm_fanout(base: str, head: str) -> list[str]:
    before = pnpm_sections(base)
    after = pnpm_sections(head)

    for key in PNPM_GLOBAL_SECTIONS:
        if before.get(key) != after.get(key):
            return [ALL]

    for key in PNPM_SHARED_MAPS:
        # A removed or rewritten line here is a version other importers could
        # have been resolving. Additions alone are a new app's new packages.
        if set(before.get(key, [])) - set(after.get(key, [])):
            return [ALL]

    before_imp = pnpm_importers(before.get("importers", []))
    after_imp = pnpm_importers(after.get("importers", []))

    touched: list[str] = []
    for path, block in after_imp.items():
        if before_imp.get(path) != block:
            # An importer outside apps/ — the workspace root — carries the
            # dev tooling every app's checks run through, and maps to no app
            # in the matrix. Escalate rather than let it be dropped silently,
            # which is exactly what the caller's path→app mapping would do.
            if not path.startswith("apps/"):
                return [ALL]
            touched.append(path)
    # An importer that disappeared belongs to an app that is gone; its own app
    # paths changed too, so the matrix already covers whatever is left of it.
    return sorted(touched)


# ── entry point ─────────────────────────────────────────────────────────────


DEFAULT_PATHS = {"cargo": "Cargo.lock", "pnpm": "pnpm-lock.yaml"}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["cargo", "pnpm"])
    parser.add_argument("--base")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--path")
    parser.add_argument("--base-file")
    parser.add_argument("--head-file")
    args = parser.parse_args(argv)

    path = args.path or DEFAULT_PATHS[args.kind]

    if args.base_file or args.head_file:
        if not (args.base_file and args.head_file):
            parser.error("--base-file and --head-file go together")
        base = open(args.base_file).read()
        head = open(args.head_file).read()
    else:
        if not args.base:
            # No base to compare against (a dispatch, or a brand-new branch):
            # we cannot prove the change is confined, so cover everything.
            print(ALL)
            return 0
        base_text = read_rev(args.base, path)
        head_text = read_rev(args.head, path)
        if base_text is None or head_text is None:
            print(ALL, file=sys.stdout)
            print(
                f"::warning::could not read {path} at {args.base}..{args.head} "
                "— covering every app",
                file=sys.stderr,
            )
            return 0
        base, head = base_text, head_text

    fanout = cargo_fanout(base, head) if args.kind == "cargo" else pnpm_fanout(base, head)
    for line in fanout:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
