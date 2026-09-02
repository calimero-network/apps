# Deploying the apps on Vercel

One Vercel project per app, all sixteen configured identically. Everything a
project needs is committed — there is **nothing to set in the dashboard beyond
the Root Directory**, and in particular **no environment variables**.

## The convention

| setting | value |
|---|---|
| Root Directory | `apps/<app>/app` |
| Framework preset | Vite (declared in `vercel.json`) |
| Build command | *(leave empty — zero-config)* |
| Output directory | `dist` (declared in `vercel.json`) |
| Install command | *(leave empty — zero-config)* |
| Environment variables | **none** |

`vercel.json` lives at `apps/<app>/app/vercel.json` and carries `framework`,
`outputDirectory`, the SPA rewrite and the cache headers, so the only thing the
dashboard has to know is the Root Directory. `scripts/check-vercel-output.sh`
(run by CI) asserts each declared `outputDirectory` is the directory the build
actually writes, and that the SPA rewrite is present.

Two dashboard settings are not expressible in the repo and must be checked by hand:

- **Include files outside the Root Directory** must be ON. This is a pnpm
  workspace: the lockfile, `pnpm-workspace.yaml` and the `catalog:` versions all
  live at the repo root, and an install scoped to `apps/<app>/app` alone cannot
  resolve `catalog:`.
- **Node version** ≥ 20 (`engines` in the root `package.json`); pnpm comes from
  the root `packageManager` field (`pnpm@9.6.0`), which Vercel honours.
  `catalog:` needs pnpm ≥ 9.5, so an older pnpm fails at install.

## Why no environment variables

Every `VITE_*` read in deployed code sits behind a committed default. In
particular `VITE_APPLICATION_ID` is needed nowhere: every consumer reads
`authApplicationId || ENV_APPLICATION_ID`, so the id mero-react resolves during
login always wins — and it must, because an ApplicationId is assigned *per
install*, so a value baked at build time is wrong on every node but the one it
was copied from.

What does matter is the pair that resolves it. mero-js only forwards them when
both are truthy:

```js
if (opts.packageName) {
  params.set("package-name", opts.packageName);
  if (opts.registryUrl) params.set("registry-url", opts.registryUrl);
}
```

so every app commits both a package default and the literal registry URL. See
PR #35.

⚠️ **mero-sign is the exception.** It does not use mero-react at all, and its
`VITE_APPLICATION_ID` / `VITE_APPLICATION_PATH` / `VITE_CONTEXT_ID` default to
stale ids pointing at a `.wasm` on S3. No environment variable will make it
work; it needs the frontend SDK port.

## ⚠️ The frontend URL is the OAuth redirect URI

Each app's `links.frontend` in its registry bundle is what authorizes the login
callback, and it is matched by **exact origin**. If a project is re-linked and
lands on a different domain (a `-git-` preview URL, a renamed project, a custom
domain), login breaks with the app looking fine. Repo metadata
(`[package.metadata.calimero.links] frontend` in `logic/Cargo.toml`) and the
published registry value currently agree for all sixteen — keep them that way,
and republish the bundle if a domain changes.

## Per-app settings

| app | Vercel project | Root Directory | Output | Frontend URL (= redirect URI) |
|---|---|---|---|---|
| `battleships` | `battleships` | `apps/battleships/app` | `dist` | https://battleships.vercel.app |
| `kv-store` | `mero-kv-store` | `apps/kv-store/app` | `dist` | https://mero-kv-store.vercel.app |
| `mero-blocks` | `mero-blocks` | `apps/mero-blocks/app` | `dist` | https://mero-blocks.vercel.app/ |
| `mero-calendar` | `mero-calendar` | `apps/mero-calendar/app` | `dist` | https://mero-calendar.vercel.app |
| `mero-drive` | `mero-drive` | `apps/mero-drive/app` | `dist` | https://mero-drive.vercel.app |
| `mero-forum` | `mero-forum` | `apps/mero-forum/app` | `dist` | https://mero-forum.vercel.app |
| `mero-issue-tracker` | `mero-issue-tracker-app` | `apps/mero-issue-tracker/app` | `dist` | https://mero-issue-tracker-app.vercel.app |
| `mero-meet` | `mero-meet` | `apps/mero-meet/app` | `dist` | https://mero-meet.vercel.app |
| `mero-sign` | `mero-sign` | `apps/mero-sign/app` | `dist` | https://mero-sign.vercel.app |
| `mero-stream` | `mero-stream-neon` | `apps/mero-stream/app` | `dist` | https://mero-stream-neon.vercel.app |
| `mero-design` | `mero-design` | `apps/mero-design/app` | `dist` | https://mero-design.vercel.app/ |
| `mero-pass` | `mero-pass` | `apps/mero-pass/app` | `dist` | https://mero-pass.vercel.app |
| `mero-pixart` | `mero-pixart` | `apps/mero-pixart/app` | `dist` | https://mero-pixart.vercel.app/ |
| `merraria` | `merraria` | `apps/merraria/app` | `dist` | https://merraria.vercel.app/ |
| `mero-sheets` | `mero-sheets` | `apps/mero-sheets/app` | `dist` | https://mero-sheets.vercel.app |
| `scaffolding-e2e` | `scaffolding-e2e-application` | `apps/scaffolding-e2e/app` | `dist` | https://scaffolding-e2e-application.vercel.app/ |

The project names above are inferred from each published `links.frontend` host,
so they are what the URLs imply rather than what the dashboard says — confirm on
re-linking. Four do **not** match the directory:
`kv-store` → `mero-kv-store`, `mero-issue-tracker` → `mero-issue-tracker-app`,
`mero-stream` → `mero-stream-neon`, `scaffolding-e2e` → `scaffolding-e2e-application`.

### ⚠️ Four Root Directory settings changed

`merodesign`, `meropass`, `meropixart` and `p2p-sheets` were renamed to
`mero-design`, `mero-pass`, `mero-pixart` and `mero-sheets`. A Vercel project's
Root Directory is a dashboard setting the repo cannot carry, so **each of those
four projects deploys nothing until its Root Directory is updated** to the new
`apps/<app>/app` path.

`mero-pass` and `mero-sheets` need creating rather than editing: their old
origins (`meropass.vercel.app`, `p2p-sheets.vercel.app`) already returned
`DEPLOYMENT_NOT_FOUND`, so no project existed to rename. mero-forum is in the
same position.

## Package ids

The registry package id is what the frontend sends at login. Since the `mero-`
rename, **every app's package id is `com.calimero.<directory>`** — with one
exception, noted below:

| app | package |
|---|---|
| `battleships` | `com.calimero.battleships` |
| `kv-store` | `com.calimero.kv-store` |
| `mero-blocks` | `com.calimero.mero-blocks` |
| `mero-calendar` | `com.calimero.mero-calendar` |
| `mero-drive` | `com.calimero.mero-drive-docs` ⚠️ |
| `mero-forum` | `com.calimero.mero-forum` |
| `mero-issue-tracker` | `com.calimero.mero-issue-tracker` |
| `mero-meet` | `com.calimero.mero-meet` |
| `mero-sign` | `com.calimero.mero-sign` |
| `mero-stream` | `com.calimero.mero-stream` |
| `mero-design` | `com.calimero.mero-design` |
| `mero-pass` | `com.calimero.mero-pass` |
| `mero-pixart` | `com.calimero.mero-pixart` |
| `merraria` | `com.calimero.merraria` |
| `mero-sheets` | `com.calimero.mero-sheets` |
| `scaffolding-e2e` | `com.calimero.scaffolding-e2e` |

The one exception is **`mero-drive`, which publishes as
`com.calimero.mero-drive-docs`** — the `-docs` suffix names the primary service
of a two-service bundle (`docs` + `registry`). It was left alone in the rename
because it already carries the `mero-` prefix; changing it would orphan its
published bundles for no naming gain.

⚠️ **The seven package ids renamed in this pass are NEW packages, not renamed
ones.** The node derives an ApplicationId from `(package, signer)` and the id is
also the deep-link slug, so the previous ids
(`com.calimero.meroblocks`, `merocalendar`, `meromeet`, `merostream`,
`merodesign`, `meropass`, `meropixart`) keep serving their old bundles, every
invite link ever shared under them stops resolving, and the version counter for
each new id restarts at 0.0.1.

A wrong package id is not a visible error: the login request names a package the
registry does not have, no applicationId comes back, and the app sits there
looking unauthenticated. `scripts/check-app-metadata.sh` holds the
directory/crate/package invariant for the repo side.
