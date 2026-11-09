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
- The hook reads the cluster's sign-up policy once it connects
  (`readSignUpPolicy`, `api.signUpAccess`). On a `closed` cluster, or an
  `invite` one when the page holds no invite token (pass
  `{ invite: () => pendingToken }`), "Create a passkey" is disabled and says
  why (`signup-unavailable`). A passkey the cluster does not know is answered
  by policy, with "Create an account here" (`signup-here`) where sign-up is
  allowed. Sign-up always makes a new passkey: WebAuthn cannot carry one over
  from another cluster. On an `invite` cluster the token goes with the sign-up.
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
`--passkey-font`, ...). Each falls back to the `@calimero-apps/glass` token,
then to the light Calimero default.
