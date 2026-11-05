# @calimero-apps/passkey

Signing in to a component app: log in with a passkey and go. No cloud
account, nothing to install, no permissions to grant.

- `usePasskeySession(app, deps, { package })` connects to the build's target
  (`connectTarget` in `@calimero-apps/connect`: the cluster the build names,
  else the cluster serving the page, else the package's primary cluster in the
  directory), restores the app's stored session, and signs in or up with a
  passkey. A dismissed browser prompt is a quiet cancel, not an error. On a
  listing page no cluster serves (a static copy built without
  `VITE_CALIMERO_CLUSTER`), the session is `{ status: "listing" }`.
- `<PasskeySignIn api={api} />` is the one sign-in control every app shows:
  "Continue with passkey" (any passkey the person made in any Calimero app,
  the rp-id is shared) and "Create a passkey" (no name to type; pass `askName`
  to offer an optional one).
- **Account recovery** (core#4844, mero-js#330). `<PasskeySignIn>` shows
  "Lost your passkey? Use a recovery code" when given the whole session
  (`api.recovery`). A person who lost every passkey enters the code they saved
  and creates a new passkey; the code is spent, and the new passkey starts
  working 72 hours later unless one of the account's existing passkeys cancels
  it. The started recovery is kept in `localStorage` per target, so the
  control reopens on its status (the time it can finish, what happens
  meanwhile) and on "Finish with your new passkey" once the time passed.
  Finishing signs in and signs out every other session of the account.
  Signed in, `<RecoveryAlert api={api} />` warns when a recovery of the
  account is under way (`/auth/me` `recoveryPending`) with a way to cancel it;
  render it where the app shows account notices. It renders nothing otherwise.

  Core runs the recovery ceremonies only on the cluster's own origins, never
  on an app's frontend, and a session opened on an app's frontend is bound to
  that app. So `api.recovery.where` is `here` for `merod local` (the dev
  server is an origin it trusts) and `console` for a Calimero Cloud app,
  where the control explains and links to Calimero Cloud's Passkeys page
  (start, finish and cancel run there). Making a recovery code is on that page
  only, for the same reason.
- `<AppListing name description package dir dev />` is the one listing page
  every app shows for `listing`: the app's name and one line on it, a primary
  "Open {name}" link to the copy Calimero Cloud serves,
  `https://{label}.apps.calimero.network/` (`appUrl` in
  `@calimero-apps/connect`, the same label core and mdma compute), a note that
  the link works once the app runs on Calimero Cloud, and "Deploy your own on
  Calimero Cloud". With `dev` (pass `import.meta.env.DEV`) it also shows
  `pnpm dev:local {dir}`. An app that is not React uses `renderListing(el,
  props)` from `@calimero-apps/passkey/listing`: the same markup and copy.

```tsx
import { AppListing, PasskeySignIn, passkeyDeps, usePasskeySession } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

const deps = passkeyDeps(import.meta.env); // module level: the hook reconnects when deps change

function App() {
  const api = usePasskeySession("my-app", deps, { package: "com.example.my-app" });
  if (api.session.status === "listing") {
    return <AppListing name="My App" description="What it does." package="com.example.my-app" dir="my-app" dev={import.meta.env.DEV} />;
  }
  if (api.session.status === "signed-out") return <PasskeySignIn api={api} />;
  // ...
}
```

Theme it with `--passkey-*` custom properties on the control or any ancestor
(`--passkey-primary-bg`, `--passkey-primary-ink`, `--passkey-secondary-bg`,
`--passkey-secondary-ink`, `--passkey-line`, `--passkey-radius`,
`--passkey-font`, `--passkey-mono`, `--passkey-warn-bg`, `--passkey-warn-ink`,
`--passkey-warn-line`, ...). Each falls back to the `@calimero-apps/glass` token,
then to the light Calimero default.
