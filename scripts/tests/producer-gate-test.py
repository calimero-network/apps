#!/usr/bin/env python3
"""A job that downloads another job's artifact must still run when it should.

GitHub skips a job whose `needs:` dependency was skipped, whatever that job's
own `if:` says, unless that `if:` carries a status function. So a consumer gated
more narrowly by its producer silently never runs: no failure, just a check
that reads "skipping" next to a green PR. That is not hypothetical: in ci.yml's
v1 pipeline `wasm` was gated on contract changes only while `browser` (which
downloaded its bundle) was gated on frontend changes too, and every
frontend-only PR got zero browser e2e (#35).

components.yml has one such link: `e2e` downloads `component-<app>-<sha>` from
`rust`. `rust` runs only for apps whose contract changed, while `e2e` also runs
when only the JS that drives a node changed (packages/merod-local, a mero-js
pin), building the wasm itself in those legs (`build: true`). This asserts:

  * `e2e` needs `rust` and still runs when `rust` was SKIPPED (an empty rust
    matrix), but not when it failed or was cancelled;
  * the artifact download is limited to legs that do not build (`!matrix.build`),
    and the build steps to the legs that do;
  * every leg's wasm comes from one of the two: scripts/ci-scope.py marks a
    leg `build: false` exactly when its app is in the `rust` matrix (pinned by
    scripts/tests/ci-scope-test.py).
"""

import pathlib
import re
import sys

WF = pathlib.Path(__file__).resolve().parents[2] / ".github/workflows/components.yml"
src = WF.read_text()
failures = []


def check(name, ok):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    if not ok:
        failures.append(name)


def job_block(text, name):
    m = re.search(rf"^  {name}:\n(.*?)(?=^  [a-z0-9-]+:\n|\Z)", text, re.M | re.S)
    return m.group(1) if m else ""


e2e = job_block(src, "e2e")
rust = job_block(src, "rust")
check("components.yml has `rust` and `e2e` jobs", bool(e2e) and bool(rust))
check("e2e needs rust", re.search(r"^    needs: \[[^\]]*\brust\b[^\]]*\]", e2e, re.M) is not None)

cond = re.search(r"^    if: >-\n((?:      .*\n)+)", e2e, re.M)
cond = " ".join(cond.group(1).split()) if cond else (re.search(r"^    if: (.+)$", e2e, re.M) or [None, ""])[1]
check("e2e's `if:` carries a status function (else a skipped rust skips it)", "!cancelled()" in cond)
check("e2e runs when rust was skipped", "needs.rust.result == 'skipped'" in cond)
check("e2e runs when rust succeeded", "needs.rust.result == 'success'" in cond)
check("e2e does not run on a failed rust", "'failure'" not in cond)

dl = re.search(r"- if: \$\{\{ !matrix\.build \}\}\n\s+uses: actions/download-artifact@v4\n\s+with:\n\s+name: component-\$\{\{ matrix\.app \}\}-", e2e)
check("only `build: false` legs download rust's artifact", dl is not None)
check("`build: true` legs run the release build", re.search(r"name: Release build\n\s+if: matrix\.build\n", e2e) is not None)
check("rust uploads that artifact", "name: component-${{ matrix.app }}-${{ github.sha }}" in rust)

if failures:
    print(f"\n{len(failures)} producer/consumer gate check(s) failed in {WF.name}")
    sys.exit(1)
print("ok")
