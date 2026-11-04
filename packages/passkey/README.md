# @calimero-apps/passkey

Signing in to a component app: log in with a passkey and go. No cloud
account, nothing to install, no permissions to grant.

- `usePasskeySession(app, deps, { package })` connects to the build's target
  (`connectTarget` in `@calimero-apps/connect`: the cluster the build names,
  else the cluster serving the page, else the package's primary cluster in the
  directory), restores the app's stored session, and signs in or up with a
  passkey. A dismissed browser prompt is a quiet cancel, not an error. On a
  listing page no cluster serves, the session is `unconfigured` with an "open
  the app from Calimero Cloud" message, or `{ status: "listing", console }`
  when the app passes `listing: true` to show its own card.
- `<PasskeySignIn api={api} />` is the one sign-in control every app shows:
  "Continue with passkey" (any passkey the person made in any Calimero app,
  the rp-id is shared) and "Create a passkey" (no name to type; pass `askName`
  to offer an optional one).

```tsx
import { PasskeySignIn, passkeyDeps, usePasskeySession } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

const deps = passkeyDeps(import.meta.env); // module level: the hook reconnects when deps change

function App() {
  const api = usePasskeySession("my-app", deps, { package: "com.example.my-app" });
  if (api.session.status === "signed-out") return <PasskeySignIn api={api} />;
  // ...
}
```

Theme it with `--passkey-*` custom properties on the control or any ancestor
(`--passkey-primary-bg`, `--passkey-primary-ink`, `--passkey-secondary-bg`,
`--passkey-secondary-ink`, `--passkey-line`, `--passkey-radius`,
`--passkey-font`, ...). Each falls back to the `@calimero-apps/glass` token,
then to the light Calimero default.
