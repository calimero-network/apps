# p2p-sheets Repo Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the p2p-sheets app from the `workshop-apps` branch into a standalone **local** repo at `../p2p-sheets` (history preserved, `recipes/` dropped, package renamed), with a curated Jekyll docs site under `/docs` and a GitHub Pages Actions workflow — leaving a repository that is *ready to push* but not yet published.

**Architecture:** Clone the source branch into a sibling working dir to preserve its commit trail, rename the branch to `main`, drop the workshop `origin`, then make forward commits that prune the tree, rewrite the README, add the docs site + Pages workflow, and end with a verification pass. Publishing (repo create, push, enabling Pages/Vercel) is explicitly **out of this plan**.

**Tech Stack:** git, pnpm (Node 22), Rust→WASM (`wasm-pack`), Python/pytest (perf tests), Jekyll + `just-the-docs` (docs site), GitHub Actions (Pages deploy).

## Global Constraints

- **All work happens in `/Users/xilosada/dev/calimero-work/p2p-sheets` (i.e. `../p2p-sheets` relative to the source repo).** The source repo `/Users/xilosada/dev/calimero-work/workshop-apps` is READ-ONLY for this plan — never commit into it.
- **Source branch to clone:** `workshop/xabi-cal/p2p-sheets-thlqrz` from `/Users/xilosada/dev/calimero-work/workshop-apps`.
- **Preserve history** — no `rebase`, `filter-repo`, or history rewrite. Prune via forward `git rm` commits only.
- **Drop `recipes/`** entirely from the working tree.
- **NO PUBLISH ACTIONS.** Do not run `gh repo create`, `git push`, `git remote add origin`, or enable Pages/Vercel. Do not create a GitHub repo. The deliverable is a local repo only.
- **Target repo identity (for docs/config content only):** `calimero-network/p2p-sheets`, public. Project Pages URL is `https://calimero-network.github.io/p2p-sheets/` → Jekyll `baseurl: "/p2p-sheets"`.
- **Package rename:** `package.json` `name` → `"p2p-sheets"`; keep scripts `logic:build`, `logic:build:release`, `app:dev`, `app:build`, `app:codegen`, `test:smoke`.
- **Docs theme:** `just-the-docs` (pinned). Docs site source dir is `docs/`. `docs/superpowers/**` is committed but EXCLUDED from the site.
- **Existing CI workflows are kept unchanged:** `.github/workflows/verify.yml` (Studio-managed, dormant on `main`) and `.github/workflows/recalc-wasm-freshness.yml`. Only ADD `pages.yml`.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Node 22** (`.nvmrc`), **pnpm** via corepack.

---

## File Structure (in `../p2p-sheets` after extraction)

```
p2p-sheets/
  app/                     # React+Vite client (Vercel target) — moved as-is
  logic/                   # Rust→WASM bundle — moved as-is
  test/                    # perf suite + spec-smoke — moved as-is
  docs/
    _config.yml            # NEW — Jekyll (just-the-docs), baseurl, exclude superpowers/
    Gemfile                # NEW — jekyll + just-the-docs pins
    index.md               # NEW — Overview / quickstart
    architecture.md        # NEW — CRDT + derive-on-read
    recalc.md              # NEW — formula engine + client WASM
    performance.md         # NEW — from test/perf/PERFORMANCE.md
    perf-suite.md          # NEW — from test/perf/README.md
    contributing.md        # NEW — build/test/bundle
    superpowers/           # kept (specs+plans), EXCLUDED from site
  .github/workflows/
    verify.yml             # kept unchanged
    recalc-wasm-freshness.yml  # kept unchanged
    pages.yml              # NEW — Jekyll build + deploy to Pages
  README.md                # REWRITTEN — project README (replaces workshop index)
  studio.config.json       # moved as-is
  vercel.json              # moved as-is
  package.json             # name→p2p-sheets, scripts pruned
  pnpm-workspace.yaml pnpm-lock.yaml .nvmrc .gitignore  # moved as-is
  (recipes/ REMOVED)
```

---

## Task 1: Extract with preserved history + prune the tree

Creates the standalone repo, drops `recipes/`, renames the package. This is the foundational task — everything else builds on the `../p2p-sheets` working tree it produces.

**Files:**
- Create (whole tree): `/Users/xilosada/dev/calimero-work/p2p-sheets` (git clone)
- Delete: `recipes/`
- Modify: `package.json` (name + scripts)

**Interfaces:**
- Produces: a git repo at `../p2p-sheets` on branch `main`, no `origin` remote, tree free of `recipes/`, `package.json` name `p2p-sheets`. Later tasks commit into this repo.

- [ ] **Step 1: Clone the source branch into the sibling dir (preserves history)**

Run from `/Users/xilosada/dev/calimero-work`:
```bash
cd /Users/xilosada/dev/calimero-work
git clone --single-branch --branch workshop/xabi-cal/p2p-sheets-thlqrz \
  workshop-apps p2p-sheets
```
Expected: `Cloning into 'p2p-sheets'...` then `done.`. The new dir `p2p-sheets/` exists.

- [ ] **Step 2: Verify the history came across**

```bash
cd /Users/xilosada/dev/calimero-work/p2p-sheets
git log --oneline | wc -l
git log --oneline -3
```
Expected: a commit count well above 1 (the full branch trail — dozens of commits), and the top commit is the docs-extraction spec commit from the source branch.

- [ ] **Step 3: Rename the branch to `main` and drop the workshop origin**

```bash
git branch -m main
git remote remove origin
git remote -v
```
Expected: `git remote -v` prints nothing (no remotes). `git branch` shows `* main`.

- [ ] **Step 4: Remove `recipes/`**

```bash
git rm -r -q recipes
git commit -q -m "$(cat <<'EOF'
chore: drop recipes/ (generic Calimero examples, not part of p2p-sheets)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify `recipes/` is gone from the tree (still in history)**

```bash
git ls-files | grep -c '^recipes/' || true      # tree: expect 0
git log --oneline -- recipes | head -1           # history: expect a commit
test -d recipes && echo "STILL PRESENT" || echo "removed from working tree"
```
Expected: `0`, a historical commit line, and `removed from working tree`.

- [ ] **Step 6: Rename the package and prune workshop-only scripts**

Replace the entire contents of `package.json` with:
```json
{
  "name": "p2p-sheets",
  "version": "1.0.0",
  "private": true,
  "packageManager": "pnpm@10.14.0",
  "scripts": {
    "logic:build": "bash logic/build-bundle.sh",
    "logic:build:release": "bash logic/build-bundle.sh --release",
    "app:dev": "pnpm --filter ./app dev",
    "app:build": "pnpm --filter ./app build",
    "app:codegen": "pnpm --filter ./app codegen",
    "test:smoke": "merobox bootstrap run test/spec-smoke.workflow.yml"
  }
}
```

- [ ] **Step 7: Verify pnpm still resolves the workspace**

```bash
pnpm install
```
Expected: install completes without error; `app` is the only workspace package resolved (per `pnpm-workspace.yaml`). A warning-free or warning-only run is fine; a hard ERR is not.

- [ ] **Step 8: Commit the package rename**

```bash
git add package.json
git commit -q -m "$(cat <<'EOF'
chore: rename package to p2p-sheets; keep logic/app/smoke scripts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Project README

Replace the workshop-index README with a real project README. Independent of the docs site (that's Task 3), but it links to it.

**Files:**
- Modify (full replace): `README.md`

**Interfaces:**
- Consumes: the extracted tree from Task 1.
- Produces: `README.md` referencing the live app URL (Vercel, TBD-at-publish — use the canonical Pages/Vercel URLs as documented links), the docs site, and the repo layout.

- [ ] **Step 1: Replace `README.md`**

Write this exact content to `README.md`:
```markdown
# p2p-sheets

A collaborative, peer-to-peer spreadsheet built on [Calimero](https://calimero.network).
Live cursors, multiple sheet tabs, a formula engine (`SUM`/`AVERAGE`/`MIN`/`MAX`/
`COUNT`, cross-sheet references), formula autocomplete, and CSV download — with
all data replicated between peers as CRDTs, no central server.

- **Live app:** deployed on Vercel (see the repo's Deployments).
- **Docs:** https://calimero-network.github.io/p2p-sheets/

## What it is

p2p-sheets is two halves:

- **`app/`** — a React + Vite + Tiptap web client. It talks to a local
  [merod](https://github.com/calimero-network/core) node over Calimero's
  JS SDK and derives cell values with a client-side WASM copy of the recalc
  engine for instant echo.
- **`logic/`** — a Rust workspace compiled to a WASM application bundle
  (`.mpk`). The spreadsheet is an inputs-only CRDT; computed values are
  derived on read (`recalc`). The same pure Rust engine compiles to browser
  WASM for the client (`recalc-wasm`).

> **Note:** the Vercel deployment serves the client. A working end-to-end
> session needs a merod node the app can reach (local or hosted). See the
> [architecture docs](https://calimero-network.github.io/p2p-sheets/architecture).

## Repo layout

| Path | What |
|---|---|
| `app/` | React/Vite client (the deployable SPA) |
| `logic/` | Rust → WASM bundle: `spreadsheet`, `recalc`, `recalc-wasm`, `types` |
| `test/` | perf workflows (`test/perf/`) + `spec-smoke.workflow.yml` |
| `docs/` | the docs site (Jekyll) + design history under `docs/superpowers/` |

## Quickstart

Requires Node 22 (`.nvmrc`), pnpm, a Rust toolchain with the
`wasm32-unknown-unknown` target, and (for the smoke test) Docker + merobox.

```bash
pnpm install              # install workspace deps

pnpm app:dev              # run the client dev server
pnpm app:build            # production build → app/dist (what Vercel deploys)

pnpm logic:build          # build the WASM app bundle (.mpk)

pnpm test:smoke           # two-node merobox smoke workflow (needs Docker)
cd test/perf/lib && python3 -m pytest    # pure perf-generator/bench tests
```

See [`docs/contributing.md`](docs/contributing.md) for the full build/test
matrix and [`docs/performance.md`](docs/performance.md) for engine benchmarks.

## License

TBD.
```

- [ ] **Step 2: Verify the README references only existing paths**

```bash
cd /Users/xilosada/dev/calimero-work/p2p-sheets
for p in app logic test docs docs/superpowers; do test -e "$p" && echo "ok $p" || echo "MISSING $p"; done
```
Expected: `ok` for all five.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -q -m "$(cat <<'EOF'
docs: project README (replaces workshop index)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Curated Jekyll docs site under `/docs`

The six-page `just-the-docs` site + Jekyll config + Gemfile. `docs/superpowers/**` stays committed but excluded from the build.

**Files:**
- Create: `docs/_config.yml`, `docs/Gemfile`, `docs/index.md`, `docs/architecture.md`, `docs/recalc.md`, `docs/performance.md`, `docs/perf-suite.md`, `docs/contributing.md`
- Read (as source): `test/perf/PERFORMANCE.md`, `test/perf/README.md`, `docs/superpowers/specs/2026-07-10-recalc-engine-architecture-design.md`, `docs/superpowers/specs/2026-07-11-recalc-phase2-client-wasm-design.md`

**Interfaces:**
- Consumes: the extracted tree.
- Produces: a Jekyll site buildable from `docs/` (verified in Task 5).

- [ ] **Step 1: Create `docs/_config.yml`**

```yaml
title: p2p-sheets
description: A collaborative, peer-to-peer spreadsheet built on Calimero.
# Project Pages live under /<repo>/. Must match the repo name.
baseurl: "/p2p-sheets"
url: "https://calimero-network.github.io"

remote_theme: just-the-docs/just-the-docs@v0.10.0
color_scheme: light

# Design history lives in-repo but is NOT part of the published site.
exclude:
  - superpowers/
  - Gemfile
  - Gemfile.lock
  - vendor/

aux_links:
  "GitHub":
    - "https://github.com/calimero-network/p2p-sheets"

nav_external_links:
  - title: Live app
    url: https://github.com/calimero-network/p2p-sheets/deployments
```

- [ ] **Step 2: Create `docs/Gemfile`**

```ruby
source "https://rubygems.org"

gem "jekyll", "~> 4.3"
gem "just-the-docs", "0.10.0"
gem "jekyll-remote-theme", "~> 0.4"
```

- [ ] **Step 3: Create `docs/index.md`** (nav order 1)

Front matter must be exact; body drawn from the root README's "What it is" +
quickstart, condensed to a landing overview.
```markdown
---
title: Overview
layout: default
nav_order: 1
---

# p2p-sheets

A collaborative, peer-to-peer spreadsheet built on [Calimero](https://calimero.network).
Live cursors, multiple sheet tabs, a formula engine with cross-sheet references,
formula autocomplete, and CSV download — all data replicated between peers as
CRDTs, with no central server.

## The two halves

- **`app/`** — a React + Vite + Tiptap client. It talks to a local merod node
  over Calimero's JS SDK and derives cell values with a client-side WASM copy of
  the recalc engine for instant echo.
- **`logic/`** — a Rust workspace compiled to a WASM application bundle (`.mpk`).
  The spreadsheet is an **inputs-only CRDT**; computed values are **derived on
  read**. The same pure Rust engine also compiles to browser WASM.

## Start here

- [Architecture](architecture) — how the CRDT + derive-on-read model works.
- [Recalc engine](recalc) — formulas, ranges, cross-sheet refs, client WASM.
- [Performance](performance) — node-side engine benchmarks.
- [Perf suite](perf-suite) — how to run the benchmark workflows.
- [Contributing](contributing) — build, test, and bundle.

> The Vercel deployment serves the **client**. A working session needs a merod
> node the app can reach — see [Architecture](architecture).
```

- [ ] **Step 4: Create `docs/architecture.md`** (nav order 2)

Front matter exact. Body: author a reader-facing architecture overview by
summarizing `docs/superpowers/specs/2026-07-10-recalc-engine-architecture-design.md`
and the reskin spec — cover: inputs-only CRDT (cells store raw values only),
derive-on-read evaluation, topological sort, group contexts + namespaces as the
p2p substrate, the `app/` ↔ `logic/` split, and the runtime dependency on a
merod node. Write 4–7 short sections; do not paste the spec verbatim.
```markdown
---
title: Architecture
layout: default
nav_order: 2
---

# Architecture

<!-- Author from 2026-07-10-recalc-engine-architecture-design.md:
     - Inputs-only CRDT: cells persist raw user input (values/formulas), never
       computed results.
     - Derive-on-read: get_cells / get_all_cells evaluate via a topological sort
       of the dependency graph; #REF!/#CYCLE! on bad graphs.
     - p2p substrate: Calimero group contexts + namespaces; each workbook is a
       context replicated between peers as CRDTs.
     - app/ vs logic/: WASM bundle (logic) runs on the node; the React client
       (app) reads/writes via the JS SDK and mirrors the engine in-browser.
     - Runtime: the client needs a reachable merod node to hold contexts. -->
```
Replace the comment with the authored sections before committing (the comment is
a content brief, not shippable output).

- [ ] **Step 5: Create `docs/recalc.md`** (nav order 3)

Front matter exact. Body: author from the recalc architecture spec + the Phase-2
client-WASM spec (`2026-07-11-recalc-phase2-client-wasm-design.md`). Cover:
supported functions (`SUM`/`AVERAGE`/`COUNT`/`MIN`/`MAX`), ranges (`A1:B2`,
whole-column `A:A` capped at 1000 rows, whole-row), single-letter column limit,
cross-sheet `[id]!A1` references, error values (`#REF!`, `#CYCLE!`), and the
Phase-2 story (the same pure Rust `recalc` crate compiled to `recalc-wasm` for
instant client-side echo).
```markdown
---
title: Recalc engine
layout: default
nav_order: 3
---

# Recalc engine

<!-- Author from the recalc-engine + phase2-client-wasm specs:
     functions, range forms + MAX_ROWS=1000 / single-letter-column limits,
     cross-sheet [id]! refs, #REF!/#CYCLE!, and recalc -> recalc-wasm reuse. -->
```
Replace the comment with authored sections before committing.

- [ ] **Step 6: Create `docs/performance.md`** (nav order 4) from the report

Prepend Jekyll front matter to the existing benchmark report so it renders in the
site, keeping the report body intact:
```bash
cd /Users/xilosada/dev/calimero-work/p2p-sheets
{ printf -- '---\ntitle: Performance\nlayout: default\nnav_order: 4\n---\n\n'; cat test/perf/PERFORMANCE.md; } > docs/performance.md
```
Then fix any relative links in `docs/performance.md` that point to `./README.md`
(the perf-suite) so they target the site page `perf-suite` instead — replace
`](./README.md)` with `](perf-suite)` and `[`README.md`](./README.md)` phrasing
accordingly.

- [ ] **Step 7: Create `docs/perf-suite.md`** (nav order 5) from the suite README

```bash
cd /Users/xilosada/dev/calimero-work/p2p-sheets
{ printf -- '---\ntitle: Perf suite\nlayout: default\nnav_order: 5\n---\n\n'; cat test/perf/README.md; } > docs/perf-suite.md
```
Then fix relative links: `[`PERFORMANCE.md`](./PERFORMANCE.md)` → `[Performance](performance)`,
and drop or repoint any link to `docs/superpowers/...` engine spec (point it at
[Architecture](architecture)). Keep the run instructions verbatim.

- [ ] **Step 8: Create `docs/contributing.md`** (nav order 6)

Front matter exact; body authored from `package.json` scripts, `logic/build-bundle.sh`,
`logic/build-recalc-wasm.sh`, and the CI workflows.
```markdown
---
title: Contributing
layout: default
nav_order: 6
---

# Contributing

## Prerequisites

- Node 22 (`.nvmrc`) + pnpm (via `corepack enable`)
- Rust toolchain with `rustup target add wasm32-unknown-unknown`
- `wasm-pack` **0.13.1** (pinned — the committed client WASM artifact must match)
- For smoke/perf e2e: Docker + `merobox` (`pipx install merobox`)

## Build

```bash
pnpm install
pnpm app:build        # client → app/dist
pnpm logic:build      # WASM app bundle (.mpk)
bash logic/build-recalc-wasm.sh   # regenerate the client recalc WASM artifact
```

## Test

```bash
# client unit tests (vitest)
pnpm --filter ./app test

# perf generators/bench (pure Python, no Docker)
cd test/perf/lib && python3 -m pytest

# two-node smoke workflow (Docker)
pnpm test:smoke

# node-side perf sweeps (Docker) — see the Perf suite page
bash test/perf/run-perf.sh

# client e2e (Playwright)
cd app && npx playwright test
```

## CI

- **`verify.yml`** — Calimero-Studio-managed gate; fires on `workshop/**` /
  `ai-builder/**` branches (dormant on `main`).
- **`recalc-wasm-freshness.yml`** — on PRs touching the recalc crates, rebuilds
  the client WASM artifact and fails if it drifts from the committed copy.
- **`pages.yml`** — builds and deploys this docs site to GitHub Pages.
```

- [ ] **Step 9: Author the two brief-only pages**

Open `docs/architecture.md` and `docs/recalc.md` and replace each HTML-comment
content brief with actual authored prose per the brief (read the referenced
specs in `docs/superpowers/specs/` to source the content). Each page: 400–800
words, reader-facing, no dated-slice framing.

- [ ] **Step 10: Verify no page still contains a content-brief comment**

```bash
cd /Users/xilosada/dev/calimero-work/p2p-sheets
grep -rl 'Author from\|content brief\|<!-- Author' docs/*.md && echo "UNFINISHED BRIEFS ABOVE" || echo "all pages authored"
```
Expected: `all pages authored`.

- [ ] **Step 11: Commit the docs site**

```bash
git add docs/_config.yml docs/Gemfile docs/index.md docs/architecture.md \
        docs/recalc.md docs/performance.md docs/perf-suite.md docs/contributing.md
git commit -q -m "$(cat <<'EOF'
docs: curated Jekyll docs site (just-the-docs) under /docs

Six-page IA (Overview/Architecture/Recalc/Performance/Perf suite/Contributing);
superpowers/ specs+plans kept but excluded from the site.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: GitHub Pages deploy workflow

Add the Actions workflow that builds the `docs/` Jekyll site and deploys it to Pages on push to `main`.

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: `docs/` site from Task 3.
- Produces: a Pages deploy workflow (runs only once pushed + Pages enabled — out of this plan's scope to trigger).

- [ ] **Step 1: Create `.github/workflows/pages.yml`**

```yaml
name: docs pages

on:
  push:
    branches: [main]
    paths:
      - 'docs/**'
      - '.github/workflows/pages.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

# One in-flight Pages deploy at a time.
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: docs
    steps:
      - uses: actions/checkout@v4

      - uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true
          working-directory: docs

      - uses: actions/configure-pages@v5

      - name: Build with Jekyll
        env:
          JEKYLL_ENV: production
        run: bundle exec jekyll build --source . --destination _site --baseurl "/p2p-sheets"

      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/_site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Lint the workflow YAML is well-formed**

```bash
cd /Users/xilosada/dev/calimero-work/p2p-sheets
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pages.yml')); print('pages.yml: valid YAML')"
```
Expected: `pages.yml: valid YAML`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -q -m "$(cat <<'EOF'
ci: GitHub Pages deploy workflow for the docs site

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Verification pass (extraction is sound)

Prove the extracted repo builds and tests before it is handed off for the gated publish. No new feature code — this is the acceptance gate.

**Files:**
- Possibly modify: `docs/Gemfile.lock` (generated), plus any fix a check surfaces.

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: a verification report (all checks green) + a final commit of any generated lockfile.

- [ ] **Step 1: Tree/history checks**

```bash
cd /Users/xilosada/dev/calimero-work/p2p-sheets
git ls-files | grep -c '^recipes/' | grep -qx 0 && echo "recipes: absent (ok)" || echo "FAIL recipes present"
git remote -v | grep -q . && echo "FAIL: has a remote" || echo "remotes: none (ok)"
git branch --show-current | grep -qx main && echo "branch: main (ok)" || echo "FAIL branch"
grep -q '"name": "p2p-sheets"' package.json && echo "pkg name ok" || echo "FAIL pkg name"
```
Expected: `recipes: absent (ok)`, `remotes: none (ok)`, `branch: main (ok)`, `pkg name ok`.

- [ ] **Step 2: App build (proves the Vercel build command)**

```bash
pnpm install
pnpm app:build
test -f app/dist/index.html && echo "app build ok (app/dist present)" || echo "FAIL app build"
```
Expected: build succeeds; `app build ok (app/dist present)`.

- [ ] **Step 3: WASM bundle build (proves the Rust→WASM path)**

```bash
bash logic/build-bundle.sh
ls logic/res/*.mpk >/dev/null 2>&1 && echo "bundle ok (.mpk present)" || echo "FAIL bundle"
```
Expected: `bundle ok (.mpk present)`. (Requires the `wasm32-unknown-unknown` target; add it with `rustup target add wasm32-unknown-unknown` if missing.)

- [ ] **Step 4: Perf generator/bench tests (pure Python)**

```bash
cd test/perf/lib && python3 -m pytest -q
```
Expected: all tests pass (the generators + bench suite). Return to repo root afterward.

- [ ] **Step 5: Docs site builds locally (Jekyll)**

```bash
cd /Users/xilosada/dev/calimero-work/p2p-sheets/docs
bundle install
bundle exec jekyll build --source . --destination _site --baseurl "/p2p-sheets"
test -f _site/index.html && echo "docs build ok" || echo "FAIL docs build"
grep -rq 'superpowers' _site && echo "FAIL: superpowers leaked into site" || echo "superpowers excluded (ok)"
rm -rf _site
```
Expected: `docs build ok` and `superpowers excluded (ok)`. (If Ruby/bundler is unavailable locally, record that this check is deferred to the Pages workflow and note it explicitly — do not silently skip.)

- [ ] **Step 6: Confirm the existing CI workflows reference only extant paths**

```bash
cd /Users/xilosada/dev/calimero-work/p2p-sheets
for f in logic/build-bundle.sh test/spec-smoke.workflow.yml logic/build-recalc-wasm.sh app/e2e; do
  test -e "$f" && echo "ok $f" || echo "MISSING $f (referenced by CI)"
done
```
Expected: `ok` for all four (verify.yml references the first two + e2e; recalc-wasm-freshness references the third).

- [ ] **Step 7: Commit the generated docs lockfile (and any fixes)**

```bash
cd /Users/xilosada/dev/calimero-work/p2p-sheets
git add docs/Gemfile.lock 2>/dev/null || true
git status --short
git commit -q -m "$(cat <<'EOF'
chore: lock docs Gemfile; verification pass green

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)" || echo "nothing to commit"
```
Expected: either a commit is made (lockfile) or `nothing to commit`. If any earlier check FAILED, stop and fix the root cause before this step — do not commit a red verification.

- [ ] **Step 8: Report the extraction is ready to publish**

Print a short summary: commit count preserved, all Task-5 checks green (or which are deferred to CI with why), and the explicit reminder that **publish (repo create + push + enabling Pages/Vercel) is the next, separately-confirmed step** — not done here.

---

## Self-Review

**1. Spec coverage:**
- §2 scope (move app/logic/test/docs/config; drop recipes/, rework README, rename pkg) → Tasks 1–2. ✅
- §3 history-preserving extraction (clone, rename main, drop origin, forward prune) → Task 1. ✅
- §4 Vercel (keep vercel.json unchanged) → nothing to do; verified extant in Task 5 tree (vercel.json moved as-is with the clone). ✅
- §5 Pages curated Jekyll site (six-page IA, exclude superpowers/) + pages.yml Actions → Tasks 3–4. ✅
- §6 root README + keep verify/recalc-wasm CI, add pages.yml → Tasks 2, 4. ✅
- §7 publish gated / not in plan → Global Constraints + Task 5 Step 8. ✅
- §8 verification checklist → Task 5. ✅

**2. Placeholder scan:** The two content-brief comments in Task 3 (Steps 4–5) are explicitly flagged as briefs to be replaced (Step 9) and gated by a check (Step 10) — not shipped placeholders. `License: TBD` in the README and `page_url` are intentional real values, not plan gaps. No `TODO`/"fill in later" steps remain.

**3. Type/name consistency:** `baseurl: "/p2p-sheets"` is identical in `_config.yml` (Task 3) and the `pages.yml` build command (Task 4). Package name `p2p-sheets` consistent (Task 1 Step 6, Task 5 Step 1). Doc filenames match nav links (`architecture`/`recalc`/`performance`/`perf-suite`/`contributing`) across index.md and the cross-links. Theme pin `just-the-docs 0.10.0` matches `remote_theme ...@v0.10.0`.
