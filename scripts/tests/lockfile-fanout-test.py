#!/usr/bin/env python3
"""Fixture tests for scripts/lockfile-fanout.py.

The decision this script makes is invisible when it is wrong: too broad and the
matrix quietly costs O(apps) per PR, too narrow and an app is skipped by CI with
nothing to notice. Neither shows up as a failure. So both branches are pinned
here against hand-written lockfile fragments, and the negative cases — the ones
that must NOT fan out — matter more than the positive ones, because a rule that
only ever answers "all" passes every test that only checks for "all".

Run: python3 scripts/tests/lockfile-fanout-test.py
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "lockfile_fanout", HERE.parent / "lockfile-fanout.py"
)
lf = importlib.util.module_from_spec(SPEC)
sys.modules["lockfile_fanout"] = lf
assert SPEC.loader is not None
SPEC.loader.exec_module(lf)

FAILURES: list[str] = []


def check(name: str, got, want) -> None:
    if got == want:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name}\n         got  {got!r}\n         want {want!r}")
        FAILURES.append(name)


# ── Cargo.lock ──────────────────────────────────────────────────────────────

CARGO_BASE = """\
version = 4

[[package]]
name = "kv-store"
version = "0.1.0"
dependencies = [
 "calimero-sdk",
]

[[package]]
name = "calimero-sdk"
version = "0.8.0"
source = "git+https://github.com/calimero-network/core?tag=0.8.0#abc123"

[[package]]
name = "serde"
version = "1.0.200"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "deadbeef"
"""

# A new app arrives: one more source-less member, plus a dependency it is the
# first to need. Nothing an existing app resolves has moved.
CARGO_ADD_APP = CARGO_BASE + """
[[package]]
name = "mero-calendar"
version = "0.1.0"
dependencies = [
 "calimero-sdk",
 "chrono",
]

[[package]]
name = "chrono"
version = "0.4.38"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "cafe"
"""

CARGO_RENAME_APP = CARGO_BASE.replace('name = "kv-store"', 'name = "kvstore"')
CARGO_BUMP_DEP = CARGO_BASE.replace('version = "1.0.200"', 'version = "1.0.201"')
CARGO_DROP_DEP = CARGO_BASE.replace(
    """
[[package]]
name = "serde"
version = "1.0.200"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "deadbeef"
""",
    "",
)
# The SDK moving is the case the whole `shared` filter exists for.
CARGO_BUMP_SDK = CARGO_BASE.replace('version = "0.8.0"', 'version = "0.9.0"')


def test_cargo() -> None:
    print("Cargo.lock")
    check("unchanged → no fan-out", lf.cargo_fanout(CARGO_BASE, CARGO_BASE), [])
    check(
        "adding an app and its new deps → no fan-out",
        lf.cargo_fanout(CARGO_BASE, CARGO_ADD_APP),
        [],
    )
    check(
        "renaming an app crate → no fan-out",
        lf.cargo_fanout(CARGO_BASE, CARGO_RENAME_APP),
        [],
    )
    check(
        "bumping a registry dep → all",
        lf.cargo_fanout(CARGO_BASE, CARGO_BUMP_DEP),
        ["all"],
    )
    check(
        "bumping the SDK → all",
        lf.cargo_fanout(CARGO_BASE, CARGO_BUMP_SDK),
        ["all"],
    )
    check(
        "dropping a dep → all",
        lf.cargo_fanout(CARGO_BASE, CARGO_DROP_DEP),
        ["all"],
    )
    check(
        "a member is never mistaken for a dep",
        sorted(lf.cargo_dep_versions(CARGO_BASE)),
        ["calimero-sdk", "serde"],
    )


# ── pnpm-lock.yaml ──────────────────────────────────────────────────────────

PNPM_BASE = """\
lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

catalogs:

  default:

    react:
      specifier: ^19.0.0
      version: 19.0.0

    '@calimero-network/mero-ui':
      specifier: ^1.5.1
      version: 1.5.1

importers:

  .:
    devDependencies:
      prettier:
        specifier: ^3.8.4
        version: 3.8.4

  apps/kv-store/app:
    dependencies:
      react:
        specifier: 'catalog:'
        version: 19.0.0
    devDependencies:
      vite:
        specifier: 'catalog:'
        version: 6.4.3(@types/node@22.20.1)

packages:

  react@19.0.0:
    resolution: {integrity: sha512-aaa}

snapshots:

  react@19.0.0: {}

  vite@6.4.3(@types/node@22.20.1):
    dependencies:
      esbuild: 0.25.0
"""

# The exact shape of the change that prompted this script: a new app's importer,
# and it is the first consumer of a catalog entry that already existed.
PNPM_ADD_IMPORTER = PNPM_BASE.replace(
    """  apps/kv-store/app:""",
    """  apps/mero-calendar/app:
    dependencies:
      '@calimero-network/mero-ui':
        specifier: 'catalog:'
        version: 1.5.1

  apps/kv-store/app:""",
)

PNPM_CHANGE_OTHER_IMPORTER = PNPM_BASE.replace(
    """      react:
        specifier: 'catalog:'
        version: 19.0.0""",
    """      react:
        specifier: 'catalog:'
        version: 19.0.1""",
)

# Sass entering the workspace rewrites every importer's vite peer key — the real
# case where fanning out to every app is the correct answer.
PNPM_SASS_PEER_REWRITE = PNPM_BASE.replace(
    "vite@6.4.3(@types/node@22.20.1)",
    "vite@6.4.3(@types/node@22.20.1)(sass@1.103.1)",
)

PNPM_CATALOG_BUMP = PNPM_BASE.replace(
    """    react:
      specifier: ^19.0.0
      version: 19.0.0""",
    """    react:
      specifier: ^19.1.0
      version: 19.1.0""",
)

PNPM_CATALOG_ADD_ENTRY = PNPM_BASE.replace(
    """    '@calimero-network/mero-ui':
      specifier: ^1.5.1
      version: 1.5.1""",
    """    '@calimero-network/mero-ui':
      specifier: ^1.5.1
      version: 1.5.1

    zustand:
      specifier: ^5.0.14
      version: 5.0.14""",
)

PNPM_SETTINGS_CHANGE = PNPM_BASE.replace(
    "autoInstallPeers: true", "autoInstallPeers: false"
)

PNPM_ADD_PACKAGE_ONLY = PNPM_BASE.replace(
    """  react@19.0.0:
    resolution: {integrity: sha512-aaa}""",
    """  react@19.0.0:
    resolution: {integrity: sha512-aaa}

  chrono@0.4.38:
    resolution: {integrity: sha512-bbb}""",
)

# The workspace root importer holds the dev tooling every app's checks use, and
# maps to no app in the matrix — so it must escalate, not be silently dropped.
PNPM_ROOT_IMPORTER_CHANGE = PNPM_BASE.replace(
    """      prettier:
        specifier: ^3.8.4
        version: 3.8.4""",
    """      prettier:
        specifier: ^3.9.0
        version: 3.9.0""",
)


def test_pnpm() -> None:
    print("pnpm-lock.yaml")
    check("unchanged → no fan-out", lf.pnpm_fanout(PNPM_BASE, PNPM_BASE), [])
    check(
        "a new app's importer → that app only",
        lf.pnpm_fanout(PNPM_BASE, PNPM_ADD_IMPORTER),
        ["apps/mero-calendar/app"],
    )
    check(
        "a new catalog entry nobody dropped → no fan-out",
        lf.pnpm_fanout(PNPM_BASE, PNPM_CATALOG_ADD_ENTRY),
        [],
    )
    check(
        "new packages entries only → no fan-out",
        lf.pnpm_fanout(PNPM_BASE, PNPM_ADD_PACKAGE_ONLY),
        [],
    )
    check(
        "another importer's version moved → that importer",
        lf.pnpm_fanout(PNPM_BASE, PNPM_CHANGE_OTHER_IMPORTER),
        ["apps/kv-store/app"],
    )
    check(
        "sass rewriting every vite peer key → all",
        lf.pnpm_fanout(PNPM_BASE, PNPM_SASS_PEER_REWRITE),
        ["all"],
    )
    check(
        "a catalog version moving → all",
        lf.pnpm_fanout(PNPM_BASE, PNPM_CATALOG_BUMP),
        ["all"],
    )
    check(
        "an install setting changing → all",
        lf.pnpm_fanout(PNPM_BASE, PNPM_SETTINGS_CHANGE),
        ["all"],
    )
    check(
        "the root importer changing → all",
        lf.pnpm_fanout(PNPM_BASE, PNPM_ROOT_IMPORTER_CHANGE),
        ["all"],
    )
    check(
        "the root importer is parsed like any other",
        sorted(lf.pnpm_importers(lf.pnpm_sections(PNPM_BASE)["importers"])),
        [".", "apps/kv-store/app"],
    )


# ── pnpm-workspace.yaml (the catalog source) ────────────────────────────────
#
# The negative cases carry the weight here. This file is heavily commented, and
# every migration PR adds catalog entries for dependencies only the arriving app
# has — so a rule that answered "all" for those would be indistinguishable from
# the flat trigger this replaced, while still passing any test that only asserts
# the positive direction.

WS_BASE = """\
packages:
  - "apps/*/app"

catalog:
  # ── Calimero ──
  "@calimero-network/mero-js": ^13.2.5
  react: ^19.0.0
  vite: ^6.4.3

onlyBuiltDependencies:
  - esbuild
"""


def test_catalog() -> None:
    print("pnpm-workspace.yaml")
    check(
        "catalog: identical file does not fan out",
        lf.catalog_fanout(WS_BASE, WS_BASE),
        [],
    )
    check(
        "catalog: a NEW entry an arriving app needs does not fan out",
        lf.catalog_fanout(WS_BASE, WS_BASE.replace("  vite: ^6.4.3", "  vite: ^6.4.3\n  zustand: ^5.0.5")),
        [],
    )
    check(
        "catalog: a reworded comment does not fan out",
        lf.catalog_fanout(WS_BASE, WS_BASE.replace("  # ── Calimero ──", "  # ── Calimero SDK ──")),
        [],
    )
    check(
        "catalog: bumping an existing entry fans out",
        lf.catalog_fanout(WS_BASE, WS_BASE.replace("vite: ^6.4.3", "vite: ^7.0.0")),
        [lf.ALL],
    )
    check(
        "catalog: deleting an existing entry fans out",
        lf.catalog_fanout(WS_BASE, WS_BASE.replace("  react: ^19.0.0\n", "")),
        [lf.ALL],
    )
    check(
        "catalog: changing the workspace globs fans out",
        lf.catalog_fanout(WS_BASE, WS_BASE.replace('  - "apps/*/app"', '  - "apps/*/app"\n  - "packages/*"')),
        [lf.ALL],
    )
    check(
        "catalog: changing build settings fans out",
        lf.catalog_fanout(WS_BASE, WS_BASE.replace("  - esbuild", "  - esbuild\n  - sharp")),
        [lf.ALL],
    )
    check(
        "catalog: a named catalog keeps its entries distinct",
        lf.catalog_fanout(
            WS_BASE + "\ncatalogs:\n  legacy:\n    react: ^18.0.0\n",
            WS_BASE + "\ncatalogs:\n  legacy:\n    react: ^18.3.0\n",
        ),
        [lf.ALL],
    )


if __name__ == "__main__":
    test_cargo()
    test_pnpm()
    test_catalog()
    print()
    if FAILURES:
        print(f"{len(FAILURES)} failure(s): {', '.join(FAILURES)}")
        sys.exit(1)
    print("all lockfile-fanout cases pass")
