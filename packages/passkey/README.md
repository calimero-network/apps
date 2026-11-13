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
  it, so the new account joins in that one step. The callback gets what the
  sign-up joined (`{ invite, org }`, `org` from the node's answer when it says
  it, else the new account's only org) and the whole pending invite (org,
  team, doc, route, the app's own parameters), so the app opens what the link
  pointed at. Without it, the token goes with a sign-up only on an `invite`
  cluster, as before.
- `<ConnectExistingOrg appName="Mero Chat" load={() => otherOrgs(client, source)} onConnect={(org) => ...} />`
  is the secondary "Connect to an existing organization" choice
  (`otherOrgs` and `orgsWithApp` in `@calimero-apps/connect`): a button
  (`connect-existing-org`) that, only when pressed, lists the account's other
  organizations with what each holds ("overworld", "Mero Blocks: overworld"),
  one button each (`connect-org-<orgId>`). Nothing is preselected; `onConnect`
  creates the app's instance there. An app's default list stays the
  organizations that already hold it, and creating a new one stays primary.
- Pass the app's invite store (`invites: createInviteStore(...)` from
  `@calimero-apps/connect`) and the hook does the rest: the token is its
  `invite`, the store is bound to the cluster, and the invite is dropped
  after a sign-up joined with it, on sign-out, and when another account signs
  in. `usePendingInvite(invites)` re-renders on its changes.
- A sign-up refused because of its invite (unknown, used up, expired, its org
  gone) drops the token, never sends it again (also when the app keeps
  handing it over), sets `api.inviteRefused` (`{ reason, token, passkeyMade }`)
  and calls `onInviteRefused`. The error says why, and on a cluster that takes
  accounts without an invite, that the account can still be made without it;
  the control then offers "Create your account without the invite"
  (`signup-without-invite`). The node judges the invite at `register/begin`,
  before the browser makes a passkey, so no passkey is left behind; only when
  the invite went bad between the two halves (`passkeyMade: true`) does the
  error say the new passkey has no account.
- `<SignInPanel>`, `<InvitationSignIn>` and `<JoinInvitation>` are the screens
  around the control (title and copy, the cluster's state, "Not now", "Join
  {joining}?", or "Join {joining} as {account}?" with `account`, already a
  member, a spent invite). They take the app's class
  names per slot (`OnboardingClassNames`), so each app keeps its look.
  `<JoinInvitation>` reports where to go: `onJoined({ org })` (the org the
  redemption joined, else the one the link named) and `onClose({ member })`
  (the org the account was already in; `null` for "Not now" or a spent
  invite). `isSpent` defaults to `isSpentInvite`, so a lapsed session, a rate
  limit or a network failure keeps the token and says to try again.
  Show it from `useAskedInvite(invites, signedIn)`: `invite` stays on screen
  after `<JoinInvitation>` drops the token (so "already in" and "used up" can
  be said) until `close()`, called from `onJoined` and `onClose`. It follows
  the store during render; an app copying the pending invite into state from
  an effect brings the prompt back for good when "Not now" lands before that
  effect runs.
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

- "A new version is available" (`@calimero-apps/passkey/upgrade`): once a
  session is signed in, `usePasskeySession` (with `package`) checks once,
  never polls, and shows a small dismissible card, "Version X of {App} is
  available (you run Y). Update / Not now", for one instance of the package
  this account may upgrade. Who may, as core's `may_upgrade` judges an
  owner-held instance: its owner, or in an organization the owner, an admin,
  a team's lead or a member holding `MANAGE_APPLICATION` there (read from
  `GET /auth/me` and `GET /orgs/{org}`; unreadable means hidden). Nothing
  for anyone else, nor when `upgradesHeldBy` is `publisher` (the publisher
  upgrades from the developer console) or `operator` (the cluster's
  governance gives upgrades to the operator). The facts come from the
  version reports (`appsReportAll`: `availableVersions`, `upgradesHeldBy`);
  Update asks for a consent request (`upgradeConsent`) and sends the person
  to the node's consent page, which sends them back with the decision, read
  with `consentResult`. An approval on a page a node serves loads the
  instance's new release at once, through `/app/{app}/` with the route and
  query, where the card says it is updated; in development it says so and
  offers Reload. "Still runs Y" is said only when the report shows the
  instance on an older release than the one approved. A frontend-only release
  (the same WASM) is offered like any other: the report lists it in
  `availableVersions`. "Not now" is remembered
  per instance and version. `{ upgradePrompt: false }` turns it off;
  `appName` names the app (default: the page title's first part). An app not
  on the hook (the launchers, mero-chat's store) calls
  `watchUpgrades({ client, package, appName, accountId })` and the function
  it returns at sign-out; `upgradeOffer(client, appId)` and
  `startUpgrade(client, appId, version, returnTo)` are the parts.

- `useInstanceRelease(client, appId)`: where the app enters an instance,
  moves a page of another release to the frontend of the release that
  instance runs (`followInstanceRelease` in `@calimero-apps/connect`, which
  says when and how). Returns `true` while leaving.

- `<ManageInHomeLink session={api.session} org={orgId} />`: one line in an
  org app's account menu, "Manage people in Calimero Home →", opening Home on
  that org in a new tab. It renders nothing unless the cluster has Calimero
  Home and the viewer is the org's owner or an admin, or a member of a shared
  org (`homeLinkFor` in `@calimero-apps/connect`, which says how); never on a
  dev server or a static host. `useHomeLink(session, org)` is the URL alone.
  Styled by `.cp-home-link` (`passkey.css`) unless given a `className`.

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
