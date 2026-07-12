# Extract p2p-sheets into a standalone repo — design

**Status:** approved design, pre-plan
**Date:** 2026-07-12
**Goal:** Extract the p2p-sheets app from the `workshop-apps` branch
`workshop/xabi-cal/p2p-sheets-thlqrz` into its own standalone public repository
`calimero-network/p2p-sheets`, with a Vercel deployment for the app and a
GitHub Pages docs site — prepared entirely locally, with the actual
publish/push gated on explicit confirmation.

---

## 1. Decisions (locked in brainstorming)

1. **Deploy split:** Vercel hosts the interactive app SPA; GitHub Pages hosts a
   separate **curated** docs site. Two URLs, two purposes ("the product" vs.
   "the docs").
2. **Git history:** **preserved** — carry this branch's commit trail forward
   (no history rewrite). The dropped `recipes/`/workshop commits remain in the
   past but leave the working tree.
3. **Repo identity:** `calimero-network/p2p-sheets`, **public**.
4. **Docs tooling:** **plain GitHub Pages (Jekyll)** from `/docs`.
5. **Docs content:** **curated IA** authored from the existing design specs;
   the raw `docs/superpowers/{specs,plans}` stay in-repo as history but are not
   in the site nav.
6. **Prep location:** sibling working dir `../p2p-sheets` (i.e.
   `/Users/xilosada/dev/calimero-work/p2p-sheets`), matching the workspace's
   sibling-clone layout.
7. **`recipes/` is dropped** (generic Calimero examples, not part of the app).

---

## 2. Scope — what moves, what's dropped

### Moves (the whole p2p-sheets project)
- `app/` — React + Vite + Tiptap client (the Vercel target).
- `logic/` — Rust Cargo workspace compiling to the WASM bundle (`.mpk`); crates
  `recalc`, `recalc-wasm`, `spreadsheet`, `types`; `build-bundle.sh`, `res/`.
- `test/` — the perf suite (`test/perf/**`) + `test/spec-smoke.workflow.yml`.
- `docs/superpowers/{specs,plans}` — kept in-repo as design history (excluded
  from the Pages site nav).
- `studio.config.json` — Calimero Studio app config.
- `vercel.json` — the app's Vercel build config.
- `.github/workflows/{verify.yml,recalc-wasm-freshness.yml}` — existing CI.
- Node/pnpm config: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`,
  `.nvmrc` (Node 22), `.gitignore`.

### Dropped
- `recipes/` — generic Calimero example recipes (authored-feed, context-metadata,
  counters, dms, private-rooms); unrelated to p2p-sheets.
- Root `README.md` (workshop-index) — replaced with a proper project README.
- `package.json` `name: "chat-root"` → `"p2p-sheets"` (and drop the
  workshop-oriented scripts that no longer apply, keeping `logic:build`,
  `app:*`, `test:smoke`).

---

## 3. Repo identity & history mechanism

Target: `calimero-network/p2p-sheets`, public.

**History-preserving extraction (local, no push):**
1. Clone this branch's history into the sibling dir:
   `git clone --single-branch --branch workshop/xabi-cal/p2p-sheets-thlqrz <workshop-apps repo path> ../p2p-sheets`.
   This carries the full commit trail of the branch.
2. In `../p2p-sheets`: rename the branch to `main`
   (`git branch -m <branch> main`) and remove the old `origin` remote (points at
   the workshop repo). A new `origin` is added only at the gated push step.
3. Make **forward** commits (no rebase/filter) that:
   - `git rm -r recipes/`,
   - replace the root `README.md`,
   - rename the package and prune workshop-only scripts,
   - add the docs site, the Pages workflow, and any config edits (§4–§6).

Rationale for no rewrite: `git filter-repo` to purge `recipes/` from all of
history is riskier and unnecessary — the goal is a clean *working tree* and a
truthful trail, not a scrubbed past. Forward removal achieves both.

---

## 4. Deploy target A — Vercel (the app)

- Keep `vercel.json` as-is: `buildCommand: "cd app && pnpm install && pnpm build"`,
  `outputDirectory: "app/dist"`, `framework: "vite"`, SPA rewrite
  `/(.*) → /index.html`.
- Deployment is via **Vercel's GitHub integration** (a Vercel Project linked to
  the repo): push to `main` → production, PRs → preview deploys. No workflow
  file needed on the GitHub side.
- **Documented caveat:** the SPA is the *client only*. At runtime it needs a
  merod node / Calimero cloud to log in and hold contexts. The public Vercel
  deploy renders and runs the UI; a working end-to-end session requires a node
  the app can reach (documented in the README + docs `architecture.md`). Wiring
  a hosted demo node is **out of scope** for this extraction (a follow-up).

---

## 5. Deploy target B — GitHub Pages (curated docs site)

- **Jekyll site rooted at `/docs`.** `docs/_config.yml` sets the title, theme,
  and nav, and **excludes `superpowers/`** from the build/nav.
- Theme: a lightweight Jekyll theme with nav support (e.g. `just-the-docs`) or
  the GitHub-supported `minima`/`primer` — chosen in the plan; keep config
  minimal.
- Deployed by a **`.github/workflows/pages.yml`** using GitHub's official Pages
  Actions (`actions/configure-pages`, `actions/jekyll-build-pages`,
  `actions/deploy-pages`) on push to `main`. Using the Actions path (rather than
  the classic "deploy from /docs branch" setting) lets us control the source dir
  and build reproducibly.

### Curated docs IA (`/docs`)
| File | Purpose | Source |
|---|---|---|
| `index.md` | Overview: what p2p-sheets is, quickstart, links to the live app + repo | new, drawn from README + reskin spec |
| `architecture.md` | Inputs-only CRDT + derive-on-read; group contexts/namespaces; app ↔ logic split | recalc-engine + reskin specs |
| `recalc.md` | Formula engine (functions, ranges, cross-sheet `[id]!` refs, `#REF!`/`#CYCLE!`), Phase-2 client WASM | recalc-engine + phase2 specs |
| `performance.md` | The benchmark report | `test/perf/PERFORMANCE.md` |
| `perf-suite.md` | How to run the perf workflows | `test/perf/README.md` |
| `contributing.md` | Build (pnpm, cargo, wasm-pack), test (vitest/pytest/Playwright), bundle | new, from build scripts + CI |
| `_config.yml` | Jekyll title/theme/nav; excludes `superpowers/` | new |

`docs/superpowers/{specs,plans}` remain committed (design provenance) but are
`exclude`d in `_config.yml` so they don't appear in the site.

---

## 6. Root README + CI

- **Root `README.md`** (replaces the workshop index): what p2p-sheets is, badges/
  links to the live app (Vercel) and docs site (Pages), a short architecture
  summary, the repo layout (`app/ logic/ test/ docs/`), and a quickstart
  (dev server, app build, WASM bundle build, node/smoke test). Links to the
  docs site for depth.
- **CI:** keep `verify.yml` and `recalc-wasm-freshness.yml` unchanged; add
  `pages.yml` (§5). Vercel needs no workflow (its GitHub app handles builds).

---

## 7. Preparation vs. the gated publish step

**Preparation (this project, fully local, zero external side effects):**
create `../p2p-sheets` with preserved history, the pruned tree, the new README,
the curated docs site, the Pages workflow, and all config — a repository that is
*ready to push*.

**Gated publish (explicit confirmation required, done last, one step at a time):**
1. `gh repo create calimero-network/p2p-sheets --public` (needs org create rights),
2. `git remote add origin …` + `git push -u origin main`,
3. enable GitHub Pages (source: GitHub Actions) in repo settings,
4. link the Vercel Project to the repo.

These are outward-facing publishing actions and are **not** part of the
preparation. Each is surfaced for confirmation when we reach it. If org create
rights are unavailable, fall back to `xilosada/p2p-sheets` (transfer later) —
confirmed at that point, not assumed here.

---

## 8. Testing / verification (of the extraction itself)

The extraction is "done right" when, in `../p2p-sheets` before any push:
- `pnpm install` at the root succeeds (workspace resolves with `app` only).
- `pnpm app:build` produces `app/dist` (proves the Vercel build command works).
- `bash logic/build-bundle.sh` produces the `.mpk` (proves the Rust→WASM path).
- `cd test/perf/lib && python3 -m pytest` passes (pure generators/bench tests).
- `git log` shows the preserved history; `git ls-files` shows **no** `recipes/`.
- Jekyll docs build locally (or via the Pages workflow dry check) with the six
  curated pages and `superpowers/` excluded.
- `verify.yml` / `recalc-wasm-freshness.yml` reference only paths that still
  exist.

Heavy e2e (Playwright, merobox smoke needing Docker/nodes) is **not** required
to validate the extraction — those are the app's own tests, unchanged by the
move.

---

## 9. Non-goals / deferred

- Wiring a hosted demo merod node / cloud so the public app is fully functional
  end-to-end (a follow-up; the deploy ships the client).
- Migrating the `docs/superpowers` specs into the curated IA wholesale (kept as
  history, not rewritten).
- Custom domains for either deploy target.
- Transferring ownership between personal/org after the fact.
- Any change to the app/logic source behavior — this is a packaging/extraction
  effort, not a feature change.

---

## 10. Open assumptions

- The `workshop-apps` branch tree is essentially the whole app minus `recipes/`;
  no other workshop-only files are tracked that need pruning (verified against
  `git ls-files` at design time: only `recipes/` and the root `README.md`).
- `calimero-network` org create rights are available to the user (fallback:
  personal account, §7).
- The existing `vercel.json` already scopes the build to `app/`, so the app
  deploy needs no path changes after extraction.
