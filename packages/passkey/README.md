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
- `<PasskeySignIn api={api} joining="the team" />` is the one sign-in control
  every app shows, for every state a visitor arrives in:

  | State | Primary action | Then |
  | --- | --- | --- |
  | Invite, no account here (none seen in this browser) | "Create your account and join {joining}": one click starts the sign-up with the invite | "Already have an account here? Join with your passkey" as a link |
  | Invite, an account here | "Join {joining} with your passkey" | no passkey/account for this cluster (`PasskeyUnknownHere`, or the prompt closed with none chosen): switches in place to create-account, one sentence, invite kept |
  | No invite | "Sign in with passkey" | "New here? Create an account", disabled with the reason on an `invite` or `closed` cluster |
  | Signing up | "Create your passkey in the browser prompt…" | the approval prompt right after; "Approve with your new passkey" only when that prompt failed or was refused |

  "An account here" is a hint the hook keeps per cluster (`accountHintKey`)
  once this browser signs in or up. Errors are plain words with the next step;
  a dismissed prompt is a quiet cancel, except a sign-up's approval, which
  waits at Approve with `SIGN_UP_NOT_FINISHED`. Pass `askName` to offer an
  optional name.
- Sign-up is two browser prompts since core rc.10: create the passkey, then
  approve once with it (core's `412 CONFIRM_REQUIRED` on the account it
  creates). The hook wraps the passkey (`signUpFlow`): the second prompt is
  asked right after the first, and waits for the person's click
  (`api.approve()`, `api.stage`) only when that ask failed or was refused.
- With `onJoinedAtSignUp` the invite goes with every sign-up the policy lets
  it, so the new account joins in that one step; the app drops its pending
  invite there (redeeming it again would spend another use). Without it, the
  token goes with a sign-up only on an `invite` cluster, as before.
- `<SignInPanel>`, `<InvitationSignIn>` and `<JoinInvitation>` are the screens
  around the control (title and copy, the cluster's state, "Not now", "Join
  {joining}?", already a member, a spent invite). They take the app's class
  names per slot (`OnboardingClassNames`), so each app keeps its look.
- The hook reads the cluster's sign-up policy once it connects
  (`readSignUpPolicy`, `api.signUpAccess`). On a `closed` cluster, or an
  `invite` one when the page holds no invite token (pass
  `{ invite: () => pendingToken }`), "Create an account" is disabled and says
  why (`signup-unavailable`). Sign-up always makes a new passkey: WebAuthn
  cannot carry one over from another cluster.
- A sign-up takes two prompts (core #4849): one makes the passkey, the second
  approves the account with it. The second is asked right away
  (`api.stage === "confirm"`). If that ask does not create the account, the
  session waits at `api.stage === "approve"` and the control shows "Approve
  with your new passkey" (`signup-approve`, `api.approve()`), with Cancel
  (`api.cancelSignUp()`), so the sign-up is never left with a passkey and no
  way to finish. A prompt the browser would not show (Safari has wanted a
  user gesture before a WebAuthn prompt: a `NotAllowedError` within 1 s; a
  prompt blocked by another one or a password manager's popup:
  `ConfirmPromptBlocked`, "A request is already pending") waits there with
  no error; any other failure (a prompt the person closed, a timeout) is
  shown with it, never a quiet cancel. After a click, a refusal within 1 s
  is asked again once. Cancel cannot close a prompt that is already open
  (mero-js's `PasskeyProvider.get` takes no `AbortSignal` yet).
- The ceremony itself has no framework (`@calimero-apps/passkey/ceremony`):
  the hook uses it, and so does an app that keeps its own session store or is
  not React (mero-chat's module store, the merraria and mero-blocks
  launchers). `signInHere` offers only the passkeys seen working on this
  cluster (`thisClusterPasskey`) and remembers the account here;
  `signUpFlowHere` + `signUpHere` make an account, carrying the page's invite
  with `join: true` and returning what it `joined`; `noAccountHereAfter`,
  `passkeyUnknownAfter`, `invitedFirst` and `describeCeremonyFailure` say what
  to show; `SIGN_IN_HINT` and `noAccountCopy` are the words. `signInHere` and
  `signUpHere` take an optional `signal` (`AbortSignal`) and pass it to
  mero-js, which closes an open prompt from the release that accepts it.
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
  if (api.session.status === "signed-out") return <PasskeySignIn api={api} joining="the team" />;
  // ...
}
```

Theme it with `--passkey-*` custom properties on the control or any ancestor
(`--passkey-primary-bg`, `--passkey-primary-ink`, `--passkey-secondary-bg`,
`--passkey-secondary-ink`, `--passkey-line`, `--passkey-radius`,
`--passkey-font`, ...). Each falls back to the `@calimero-apps/glass` token,
then to the light Calimero default.
