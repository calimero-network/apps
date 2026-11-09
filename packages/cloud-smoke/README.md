# @calimero-apps/cloud-smoke

Signs in to apps a real Calimero Cloud (TDX) cluster serves, the way a person
does. Nothing local: the browser opens `https://{label}.apps.calimero.network/`
(`appUrl(pkg)` in `@calimero-apps/connect`) and goes through the app's own UI.

For each package it:

1. opens the served URL and asserts a 200 HTML page;
2. reads the served page's `Content-Security-Policy` and asserts `connect-src`
   allows `https://cloud.calimero.network` and every node in
   `/.well-known/calimero.json` (`api`), failing with a message naming
   core#4861 if not;
3. asserts the cloud mirror answers `/api/tee/pcs` with Intel's collateral, not
   the console's HTML;
4. with Chrome's CDP virtual authenticator (ctap2, internal, resident key, user
   verification), signs up a **fresh** passkey account, signs out, signs back
   in with the same passkey, runs one call to the cluster (kv-store: the
   account's store list; chat: the account's workspace list) and signs out.

Console errors, CSP violation events and failed requests are collected and
attached (`browser-log.txt`); any CSP violation, "Load failed" or "Failed to
fetch" fails the run. Steps 2 and 3 are soft, so one report shows what a bad
policy does to a real sign-up too.

Why: the app and studio e2e suites run on `merod local`, whose mock quotes
fetch nothing, so they cannot see what a served page needs from the network.
core#4861 (a CSP without the cloud mirror, so every node-served frontend failed
to sign in with "Load failed") shipped unnoticed for that reason.

## Run it after rolling a cluster

From GitHub: **Actions → Cloud smoke → Run workflow**, with the packages that
cluster serves (comma or space separated). It also runs nightly for
`com.calimero.kv-store`. On a failure the run uploads the Playwright trace,
screenshots, video and HTML report as `cloud-smoke-<run id>`.

Locally:

```sh
pnpm install
cd packages/cloud-smoke
npx playwright install chromium   # once
npx playwright test               # kv-store on apps.calimero.network
SMOKE_PACKAGES="com.calimero.kv-store com.calimero.chat" npx playwright test
```

| Variable            | Default                  | What                                                              |
| ------------------- | ------------------------ | ----------------------------------------------------------------- |
| `SMOKE_PACKAGES`    | `com.calimero.kv-store`  | Package ids, comma or space separated.                            |
| `SMOKE_APPS_DOMAIN` | `apps.calimero.network`  | The apps domain the label is put under.                           |
| `SMOKE_URL`         | (derived)                | One URL to open instead, with a single package in SMOKE_PACKAGES. |

Every app signs in through `@calimero-apps/passkey`'s `<PasskeySignIn>`
(`signup-passkey`, `signin-passkey`, `signin-error`), so any served app gets
steps 1 to 4. By default the test expects the control on load and a "Sign out"
button once signed in; an app that wraps it differently has an entry in
`FLOWS` (`src/signin.smoke.ts`). The app-specific call is in
`SIGNED_IN_CHECKS`, which kv-store and chat have today.

## Chat (`com.calimero.chat`)

Chat is not in the default list: a package no cluster serves is not skipped,
it fails at step 1, and no cluster serves chat yet
(`GET https://manager.cloud.calimero.network/api/v2/directory/package/com.calimero.chat`
answers "No cluster serves com.calimero.chat"). Once a cluster serves it, run
it by hand (**Run workflow** with `com.calimero.chat` in packages) or locally:

```sh
SMOKE_PACKAGES=com.calimero.chat npx playwright test
```

Its flow: the landing page's "Sign in" opens the passkey popup, "Create a
passkey" asks for an optional name and is pressed again, and once signed in
the workspace picker must list the account's workspaces ("Welcome to MeroChat"
for a fresh account) with "Disconnect node" to sign out. The chat's own view
methods need a workspace, which a fresh account does not have, so the check
stops at the list. Any CSP violation on the way (link previews, avatars,
attachments) fails the run like any other app's.

## Accounts and sign-up policy

Each run signs up one new passkey account; nothing is stored between runs and
no secret is needed. That needs the cluster's sign-up policy (core#4848) to be
`open`: eu-shared-2 answered `GET /sign-up` with
`{"policy":"open","orgInvites":true,"signUpInvites":true,"inviteRequired":false}`
on 2026-11-05. The served apps have no invite field, so on an `invite` or
`closed` cluster a person cannot sign up from the app either; the test then
fails at sign-up with the cluster's refusal and a hint naming the policy.

The test is never retried (`retries: 0`): a retry would make a second account
and hide a sign-in that only works the second time.
