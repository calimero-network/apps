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
| `merodesign` | `mero-design` | `apps/merodesign/app` | `dist` | https://mero-design.vercel.app/ |
| `meropass` | `meropass` | `apps/meropass/app` | `dist` | https://meropass.vercel.app |
| `meropixart` | `mero-pixart` | `apps/meropixart/app` | `dist` | https://mero-pixart.vercel.app/ |
| `merraria` | `merraria` | `apps/merraria/app` | `dist` | https://merraria.vercel.app/ |
| `p2p-sheets` | `p2p-sheets` | `apps/p2p-sheets/app` | `dist` | https://p2p-sheets.vercel.app |
| `scaffolding-e2e` | `scaffolding-e2e-application` | `apps/scaffolding-e2e/app` | `dist` | https://scaffolding-e2e-application.vercel.app/ |

The project names above are inferred from each published `links.frontend` host,
so they are what the URLs imply rather than what the dashboard says — confirm on
re-linking. Note the ones that do **not** simply match the directory:
`kv-store` → `mero-kv-store`, `mero-issue-tracker` → `mero-issue-tracker-app`,
`mero-stream` → `mero-stream-neon`, `merodesign` → `mero-design`,
`meropixart` → `mero-pixart`, `scaffolding-e2e` → `scaffolding-e2e-application`.

## Package ids

The registry package id is **not** derivable from the directory name for four
apps, and it is what the frontend sends at login:

| app | package |
|---|---|
| `battleships` | `com.calimero.battleships` |
| `kv-store` | `com.calimero.kv-store` |
| `mero-blocks` | `com.calimero.meroblocks` |
| `mero-calendar` | `com.calimero.merocalendar` |
| `mero-drive` | `com.calimero.mero-drive-docs` ⚠️ |
| `mero-forum` | `com.calimero.mero-forum` |
| `mero-issue-tracker` | `com.calimero.mero-issue-tracker` |
| `mero-meet` | `com.calimero.meromeet` |
| `mero-sign` | `com.calimero.mero-sign` |
| `mero-stream` | `com.calimero.merostream` |
| `merodesign` | `com.calimero.merodesign` |
| `meropass` | `com.calimero.meropass` |
| `meropixart` | `com.calimero.meropixart` |
| `merraria` | `com.calimero.merraria` |
| `p2p-sheets` | `com.calimero.mero-sheets` ⚠️ |
| `scaffolding-e2e` | `com.calimero.scaffolding-e2e` |

Two are not derivable from the directory name at all, and are the ones to get
wrong: **`p2p-sheets` publishes as `com.calimero.mero-sheets`** and
**`mero-drive` as `com.calimero.mero-drive-docs`**. Five more merely drop the
hyphen — `mero-blocks` → `meroblocks`, and likewise `merocalendar`, `meromeet`,
`merostream`, `meropixart`.

A wrong package id is not a visible error: the login request names a package the
registry does not have, no applicationId comes back, and the app sits there
looking unauthenticated. `scripts/check-app-metadata.sh` holds the
directory/crate/package invariant for the repo side.
