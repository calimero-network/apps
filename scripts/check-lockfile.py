#!/usr/bin/env python3
"""Assert pnpm-lock.yaml is not a git-merged hybrid.

WHY THIS EXISTS

Two dependency PRs merged back to back reds EVERY app. `pnpm-lock.yaml` is one
file that both touched, git line-merges it without understanding it, and the
result can contain the same mapping key twice. pnpm then refuses it outright:

    ERR_PNPM_BROKEN_LOCKFILE  The lockfile at ".../pnpm-lock.yaml" is broken:
    duplicated mapping key (10682:3)

Every job that installs dies at `pnpm install`, so the failure looks like the
whole frontend broke rather than like a merge artifact. It happened here on
2026-09-03: apps#62 and apps#61 both bumped dependencies, both were merged
within a minute, and main went red across twelve Browser E2E legs plus the
frontend job. The duplicated key was in NEITHER branch — git produced it.

The fix is always the same: `pnpm install --lockfile-only` on the merged tree
and commit the regenerated file. This check catches it before it reaches main
and, more usefully, names the cause.

⚠️ Duplicate keys are legal YAML — a parser takes the last one and moves on —
which is why nothing but pnpm noticed. So this loads with a strict constructor
that treats a repeat as an error, rather than trusting a plain parse.

Stdlib plus PyYAML, which the metadata job already has.
"""

import os
import sys

import yaml

REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
LOCKFILE = os.path.join(REPO, "pnpm-lock.yaml")


class Strict(yaml.SafeLoader):
    """SafeLoader that refuses a duplicated mapping key instead of taking the last."""


def _no_duplicates(loader, node, deep=False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise yaml.constructor.ConstructorError(
                None, None, f"duplicated mapping key {key!r}", key_node.start_mark
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


Strict.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _no_duplicates
)


def main() -> int:
    if not os.path.isfile(LOCKFILE):
        print("::error::pnpm-lock.yaml is missing")
        return 1

    try:
        with open(LOCKFILE) as fh:
            yaml.load(fh, Loader=Strict)
    except yaml.constructor.ConstructorError as exc:
        where = str(exc.problem_mark).strip() if exc.problem_mark else "unknown line"
        print(
            f"::error::pnpm-lock.yaml has a {exc.problem} — {where}. This is what a "
            f"git line-merge of two dependency branches produces, and pnpm refuses "
            f"the whole file (ERR_PNPM_BROKEN_LOCKFILE), so every job that installs "
            f"dies before it runs anything. Fix: `pnpm install --lockfile-only` on "
            f"this tree and commit the regenerated pnpm-lock.yaml."
        )
        return 1
    except yaml.YAMLError as exc:
        print(f"::error::pnpm-lock.yaml is not valid YAML: {exc}")
        return 1

    print("pnpm-lock.yaml parses with no duplicated keys")
    return 0


if __name__ == "__main__":
    sys.exit(main())
