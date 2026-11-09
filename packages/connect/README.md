# @calimero-apps/connect

Where a component app's frontend connects, from the build's environment: the
`merod local` nodes on the dev server, a Calimero Cloud cluster (by name,
through the cloud's node directory, with failover) in a production build, both
through mero-js's `CalimeroClient`.

```ts
import { browserPasskey } from "@calimero-network/mero-js";
import { appSource, connectTarget, createClient, SessionStore } from "@calimero-apps/connect";

const target = await connectTarget(import.meta.env, { app: "my-app" });
const client = await createClient(target);
const sessions = new SessionStore("my-app", target);
if (!sessions.restore(client)) await client.signIn(browserPasskey());
sessions.sync(client);
const app = await client.createApp("my-app", appSource(import.meta.env, "com.calimero.my-app"));
```

| | local | cloud | node |
|---|---|---|---|
| chosen when | `vite` (`DEV`), or `VITE_CALIMERO_TARGET=local` | `vite build`, or `VITE_CALIMERO_TARGET=cloud` | `VITE_CALIMERO_TARGET=node` |
| nodes | `VITE_CALIMERO_NODES`, default `127.0.0.1:2501-2503` | the cluster serving the page; else `VITE_CALIMERO_CLUSTER` (optional override) via the node directory; else the primary cluster running the app's package (`GET {directory}/package/{package}`); `VITE_CALIMERO_ZONE`, `VITE_CALIMERO_DIRECTORY` | `VITE_CALIMERO_NODES` (required, `https`), no directory |
| trust | mock quotes (`allowMock`) | signed mero-tee release `>= VITE_CALIMERO_MIN_RELEASE` (required) | the same as cloud |
| instances from | `VITE_CALIMERO_BUNDLE` (written by `pnpm dev:local`) | the package (`VITE_CALIMERO_PACKAGE`, `VITE_CALIMERO_VERSION`) | the same as cloud |

The target is fixed when the service starts, from its build's environment. The
person using the app never chooses a cloud, a cluster or a node: they sign in
or up with a passkey on the one target the service was built for. A `node`
target is a `cloud` target with `direct: true`, its `nodes` set and `cluster`
naming the first node's host, so code that handles `local` and `cloud` handles
it unchanged.

On a page the cluster serves from the app's bundle (the production frontend:
the only origin a Cloud node trusts for an app's passkey ceremonies besides its
own), `connectTarget` takes the cluster's API URLs from
`/.well-known/calimero.json` instead of the directory, which that page's CSP
does not allow. That frontend is built once and served by every cluster it is
deployed to, so it needs no `VITE_CALIMERO_CLUSTER`: on a served page a build
without one connects to the nodes that serve it, keyed by the page's host
(`{label}.{apps_domain}`, one per package and cluster). `VITE_CALIMERO_MIN_RELEASE`
is required everywhere: it is the attestation floor. Off a served page, a build
without a cluster asks the directory where the app's package runs
(`GET {VITE_CALIMERO_DIRECTORY or mero-js's DEFAULT_DIRECTORY}/package/{package}`,
the package from `VITE_CALIMERO_PACKAGE` or `connectTarget`'s `package` option)
and connects to its primary cluster's nodes, the build's zone first, then
heaviest first: a frontend the developer hosts needs no cluster name.
When nothing runs the package (404), or the build has no floor or package,
it throws `NotServedError` (a `ConfigError`), which an app shows as "open the app
from Calimero Cloud" with a link to `CLOUD_CONSOLE`. Any other misconfigured
production build throws `ConfigError` instead of connecting anywhere.
`resolveTarget` and `withServedNodes`, which `connectTarget` is built on, are
still exported for code that only reads the build's environment. Sessions are stored per app and per target. See
[docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md).

Signing up follows the cluster's sign-up policy (core's `GET /sign-up`):
`readSignUpPolicy(client)` reads it (`null` on a node without the route, which
blocks nothing), `signUpAccess(policy, hasInviteToken)` says whether this page
may create an account (`allowed`, `needs-invite`, `closed`, `unknown`),
`signUpNotice` says why not, and `signUpInvite(policy, token)` is the invite to
send with `signUp` where the policy requires one. `describeSignInError(error,
access)` answers a passkey the cluster does not know with the way in for that
policy, and a refused sign-up (`SignUpRefused`) by its reason.
