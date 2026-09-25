#!/usr/bin/env python3
"""check-live-frontends.py must read titles from before an app directory rename.

Its history lookup used to `git show <sha>:<current path>`, which does not exist
on the pre-rename side, so a renamed app's live deployment read as "never built
here" and failed the build instead of reporting a deploy lag.
"""

import importlib.util
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]

spec = importlib.util.spec_from_file_location("live", ROOT / "scripts/check-live-frontends.py")
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)


def git(repo, *args):
    # A throwaway repo: no identity or signing from the caller's config applies.
    subprocess.run(
        ["git", "-c", "user.name=test", "-c", "user.email=test@example.com",
         "-c", "commit.gpgsign=false", *args],
        cwd=repo, check=True, capture_output=True,
    )


with tempfile.TemporaryDirectory() as repo:
    old = pathlib.Path(repo, "apps/old-name/app/index.html")
    old.parent.mkdir(parents=True)
    # Enough unchanged lines for git's rename detection to pair the two paths.
    body = "".join(f"<meta name=\"m{i}\" />\n" for i in range(20))
    old.write_text(f"<html>\n<head>\n<title>Old Name</title>\n{body}</head>\n</html>\n")
    git(repo, "init", "-q")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "add")
    git(repo, "mv", "apps/old-name", "apps/new-name")
    new = pathlib.Path(repo, "apps/new-name/app/index.html")
    new.write_text(new.read_text().replace("Old Name", "New Name"))
    git(repo, "commit", "-q", "-am", "rename")

    live.REPO = repo
    titles = live.historical_titles("new-name")

if titles != {"Old Name", "New Name"}:
    print(f"FAIL: expected both titles across the rename, got {sorted(titles)}")
    sys.exit(1)
print("ok: historical titles follow an app directory rename")
