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

pnpm-workspace.yaml is the catalog SOURCE, and it was a flat trigger for the same
reason the lockfiles were: any edit covered every app. But the catalog is a map,
and an app arriving with dependencies no one else has only ADDS keys to it —
which cannot change what another app resolves, exactly like a new importer block.
What can: an existing entry's version moving or being deleted, and any change
outside the catalog (`packages:` globs, `onlyBuiltDependencies`, …), which is
workspace configuration by definition.

Cargo.toml is the workspace manifest, and it was a flat trigger for the same
reason: any edit covered every app. But porting an app to the component SDK
(docs/COMPONENT-APPS.md) edits it in exactly one place, appending the app's
crate to `[workspace].exclude`. Taking a crate OUT of the workspace cannot
change another member's bytes (whatever it does to resolution shows up in
Cargo.lock, which is judged on its own). So `manifest` compares the two
manifests with `[workspace].exclude` set aside, and for the v1 pipeline also
the `component-*` keys of `[workspace.metadata.mero-apps]`, which only the
component apps build against. Anything else that differs covers every app, and
so does a manifest that does not parse.

USAGE

  lockfile-fanout.py cargo   --base-file A --head-file B
  lockfile-fanout.py pnpm    --base-file A --head-file B
  lockfile-fanout.py catalog --base-file A --head-file B
  lockfile-fanout.py manifest [--for components] --base-file A --head-file B
  lockfile-fanout.py {cargo,pnpm,catalog,manifest} --base REV --head REV [--path FILE]

Prints either the single word `all`, or zero or more paths whose apps this
change reaches (for pnpm: the importer directories), one per line. Empty output
means "no app beyond those whose files already changed".

Python, not bash, on purpose: this compares parsed blocks, and the repo has to
be able to run its own CI logic on macOS's bash 3.2 (no associative arrays).
"""

from __future__ import annotations

import argparse
import copy
import subprocess
import sys
import tomllib

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
# workspace-wide change: the lockfile format itself, install settings, forced
# overrides, the install hooks file and dependency patches.
PNPM_GLOBAL_SECTIONS = ("lockfileVersion", "settings", "overrides",
                        "pnpmfileChecksum", "patchedDependencies")
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


def pnpm_entries(section_lines: list[str]) -> dict[str, list[str]]:
    """{entry key: its block} out of `packages:` or `snapshots:`."""
    entries: dict[str, list[str]] = {}
    current = None
    for line in section_lines:
        if not line.strip():
            continue
        stripped = line.lstrip()
        indent = len(line) - len(stripped)
        if indent == 0:
            continue  # the section key itself
        if indent == 2:
            current = stripped.rstrip(":").strip().strip("'\"")
            # `name@1.0.0: {}` keeps its (empty) body on the key line.
            entries[current] = [stripped] if not stripped.endswith(":") else []
        elif current is not None:
            entries[current].append(line)
    return entries


def _pnpm_name_version(key: str) -> tuple[str, str]:
    """`name@version(peers)` → (name, `version(peers)`); scoped names keep their `@`."""
    plain = key.split("(", 1)[0]
    name = plain.rsplit("@", 1)[0]
    return name, key[len(name) + 1:]


def _pnpm_references(sections: dict[str, list[str]]) -> set[tuple[str, str]]:
    """Every (name, version) an importer or a snapshot's dependency list names.

    Importers spell a dependency as a `name:` block holding `version: v`;
    snapshots as `name: v` under `dependencies:` / `optionalDependencies:`.
    """
    refs: set[tuple[str, str]] = set()
    for key in ("importers", "snapshots"):
        last_name = None
        for line in sections.get(key, []):
            stripped = line.strip()
            if not stripped or ":" not in stripped:
                continue
            if stripped.endswith(":"):
                last_name = stripped[:-1].strip().strip("'\"")
                continue
            field, value = stripped.split(":", 1)
            field = field.strip().strip("'\"")
            value = value.strip().strip("'\"")
            if not value or field == "specifier":
                continue
            if key == "importers" and field == "version" and last_name:
                refs.add((last_name, value))
            elif key == "snapshots":
                refs.add((field, value))
    return refs


def pnpm_fanout(base: str, head: str) -> list[str]:
    before = pnpm_sections(base)
    after = pnpm_sections(head)

    for key in PNPM_GLOBAL_SECTIONS:
        if before.get(key) != after.get(key):
            return [ALL]

    # `catalogs:` keeps one block per catalog, so it is compared by line: a
    # removed or rewritten line is a pin that moved (see PNPM_SHARED_MAPS).
    if set(before.get("catalogs", [])) - set(after.get("catalogs", [])):
        return [ALL]

    # `packages:` and `snapshots:` are compared by ENTRY. One rewritten in
    # place (same `name@version(peers)` key, other content) is a version other
    # importers resolve through. One that is added is a new app's package. One
    # that is removed is fine only if nothing left in the lockfile still names
    # that exact version: porting an app drops the last user of its old v1
    # dependencies, and that must not cover every app, while the Sass case
    # (a peer key renamed under importers that still point at it) still must.
    head_refs = _pnpm_references(after)
    for key in ("packages", "snapshots"):
        b_entries = pnpm_entries(before.get(key, []))
        a_entries = pnpm_entries(after.get(key, []))
        for k, v in b_entries.items():
            if k in a_entries:
                if a_entries[k] != v:
                    return [ALL]
            elif _pnpm_name_version(k) in head_refs:
                return [ALL]

    before_imp = pnpm_importers(before.get("importers", []))
    after_imp = pnpm_importers(after.get("importers", []))

    touched: list[str] = []
    for path, block in after_imp.items():
        if before_imp.get(path) != block:
            # The workspace root importer carries the dev tooling every app's
            # checks run through, and maps to no app in the matrix. Escalate
            # rather than let it be dropped silently, which is exactly what the
            # caller's path→app mapping would do. A `packages/<p>` importer is
            # not that: the caller maps it to <p>'s dependents (ci-scope.py),
            # the same as a change to <p>'s own files. Escalating it rebuilt
            # every app when one package's devDependencies moved (#610).
            if not path.startswith(("apps/", "packages/")):
                return [ALL]
            touched.append(path)
    # An importer that disappeared belongs to an app that is gone; its own app
    # paths changed too, so the matrix already covers whatever is left of it.
    return sorted(touched)


# ── pnpm-workspace.yaml (the catalog source) ────────────────────────────────

# The only sections whose contents are a map of name -> version that an app may
# extend without consequence. `catalogs:` is the named-catalog form of the same
# thing. Everything else at top level — `packages:`, `onlyBuiltDependencies:`,
# `allowBuilds:`, `overrides:` — is workspace configuration, where any edit is
# everyone's business.
CATALOG_SECTIONS = ("catalog", "catalogs")


def catalog_entries(section_lines: list[str]) -> dict[str, str]:
    """{dependency: version} out of a catalog section, ignoring comments.

    Comments are dropped on purpose: a reworded comment above a catalog entry
    changes no resolution, and treating it as one would put this right back to
    fanning out on every edit.

    Named catalogs (`catalogs: <name>: <dep>: <ver>`) are flattened with the
    catalog name in the key, so two catalogs pinning the same dependency to
    different versions stay distinct.
    """
    entries: dict[str, str] = {}
    group = ""
    for line in section_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        if indent == 0:
            continue  # the section key itself
        if ":" not in stripped:
            continue
        key, _, value = stripped.partition(":")
        key = key.strip().strip("'\"")
        value = value.strip()
        if not value:
            # A named catalog opens a nested block; remember whose it is.
            group = key
            continue
        entries[f"{group}/{key}" if group else key] = value
    return entries


def _strip_comments(text: str) -> str:
    """Drop comment-only and blank lines.

    Needed before sectioning, not just when comparing: a comment at column 0
    looks exactly like a top-level key to `pnpm_sections`, so a reworded comment
    above `catalog:` would invent a section and fan out to every app. This file
    is heavily commented by design, which makes that the common case rather than
    a corner one.
    """
    return "\n".join(
        line
        for line in text.splitlines()
        if line.strip() and not line.strip().startswith("#")
    )


def catalog_fanout(base: str, head: str) -> list[str]:
    before = pnpm_sections(_strip_comments(base))
    after = pnpm_sections(_strip_comments(head))

    # Anything that is not a catalog is workspace configuration.
    for key in set(before) | set(after):
        if key in CATALOG_SECTIONS:
            continue
        if before.get(key) != after.get(key):
            return [ALL]

    for key in CATALOG_SECTIONS:
        b = catalog_entries(before.get(key, []))
        a = catalog_entries(after.get(key, []))
        for dep, version in b.items():
            # Moved or removed. A pure addition leaves every existing pin alone,
            # so no other app's resolution can have changed.
            if a.get(dep) != version:
                return [ALL]
    return []


# ── Cargo.toml ──────────────────────────────────────────────────────────────


def _manifest_without_exclusions(text: str, audience: str) -> dict:
    """The manifest with what cannot reach `audience`'s apps set aside."""
    doc = copy.deepcopy(tomllib.loads(text))
    ws = doc.get("workspace", {})
    ws.pop("exclude", None)
    if audience == "v1":
        meta = ws.get("metadata", {}).get("mero-apps", {})
        for key in [k for k in meta if k.startswith("component-")]:
            del meta[key]
    return doc


def manifest_fanout(base: str, head: str, audience: str = "v1") -> list[str]:
    try:
        before = _manifest_without_exclusions(base, audience)
        after = _manifest_without_exclusions(head, audience)
    except tomllib.TOMLDecodeError:
        return [ALL]
    return [] if before == after else [ALL]


# ── entry point ─────────────────────────────────────────────────────────────


DEFAULT_PATHS = {
    "cargo": "Cargo.lock",
    "pnpm": "pnpm-lock.yaml",
    "catalog": "pnpm-workspace.yaml",
    "manifest": "Cargo.toml",
}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["cargo", "pnpm", "catalog", "manifest"])
    parser.add_argument(
        "--for",
        dest="audience",
        choices=["v1", "components"],
        default="v1",
        help="manifest only: whose apps (ci.yml: v1, components.yml: components)",
    )
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

    if args.kind == "manifest":
        fanout = manifest_fanout(base, head, args.audience)
    else:
        fanout = {
            "cargo": cargo_fanout,
            "pnpm": pnpm_fanout,
            "catalog": catalog_fanout,
        }[args.kind](base, head)
    for line in fanout:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
