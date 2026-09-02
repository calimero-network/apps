#!/usr/bin/env python3
"""A job that downloads another job's artifact must not have a NARROWER gate
than its producer.

GitHub skips a job whose `needs:` dependency was skipped, whatever that job's
own `if:` says. So when a producer's `if:` is stricter than a consumer's, the
consumer silently never runs on the difference between them — no failure, just
a check that reads "skipping" next to a green PR.

That is not hypothetical: `wasm` was gated on contract changes only while
`browser` (which `needs:` it and downloads `mpk-<app>-<sha>`) was gated on
frontend changes too. Every frontend-only PR got zero browser e2e, including
the login-wiring change in #35.

This asserts the producer's condition is not stricter than its consumers', by
comparing the SET of `needs.changes.outputs.*` flags each one accepts.
"""

import pathlib
import re
import sys

CI = pathlib.Path(__file__).resolve().parents[2] / ".github/workflows/ci.yml"

# consumer -> the job whose uploaded artifact it downloads
ARTIFACT_DEPS = {"browser": "wasm", "e2e": "wasm"}

src = CI.read_text()


def job_conditions(text):
    """Map job name -> the `if:` expression on that job (not on its steps)."""
    out = {}
    job = None
    for line in text.splitlines():
        m = re.match(r"^  ([a-z0-9-]+):\s*$", line)
        if m:
            job = m.group(1)
            continue
        m = re.match(r"^    if:\s*(.+?)\s*$", line)
        if m and job:
            out.setdefault(job, m.group(1))
    return out


def flags(expr):
    """The set of `changes` outputs the expression accepts as a trigger."""
    return set(re.findall(r"needs\.changes\.outputs\.([a-z_]+)\s*==\s*'true'", expr))


conds = job_conditions(src)
failures = []

for consumer, producer in ARTIFACT_DEPS.items():
    if consumer not in conds:
        failures.append(f"{consumer}: no job-level `if:` found — did the job get renamed?")
        continue
    if producer not in conds:
        failures.append(f"{producer}: no job-level `if:` found — did the job get renamed?")
        continue

    missing = flags(conds[consumer]) - flags(conds[producer])
    if missing:
        failures.append(
            f"`{producer}` (producer) does not run for: {', '.join(sorted(missing))}\n"
            f"    but `{consumer}` (consumer) does, and it `needs: {producer}` to\n"
            f"    download its artifact — so `{consumer}` will be SKIPPED, not run,\n"
            f"    on exactly those changes. Widen `{producer}`'s `if:` to cover them."
        )

if failures:
    print("producer/consumer gate mismatch in .github/workflows/ci.yml:\n")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)

for consumer, producer in ARTIFACT_DEPS.items():
    print(f"ok: {producer} covers every trigger of {consumer}")
