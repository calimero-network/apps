# @calimero-apps/connect

Where a component app's frontend connects, from the build's environment: the
`merod local` nodes on the dev server, a Calimero Cloud cluster (by name,
through the cloud's node directory, with failover) in a production build, both
through mero-js's `CalimeroClient`.

```ts
import { browserPasskey } from "@calimero-network/mero-js";
import { appSource, createClient, resolveTarget, SessionStore, withServedNodes } from "@calimero-apps/connect";

const target = await withServedNodes(resolveTarget(import.meta.env));
const client = await createClient(target);
const sessions = new SessionStore("my-app", target);
if (!sessions.restore(client)) await client.signIn(browserPasskey());
sessions.sync(client);
const app = await client.createApp("my-app", appSource(import.meta.env, "com.calimero.my-app"));
```

| | local | cloud |
|---|---|---|
| chosen when | `vite` (`DEV`), or `VITE_CALIMERO_TARGET=local` | `vite build`, or `VITE_CALIMERO_TARGET=cloud` |
| nodes | `VITE_CALIMERO_NODES`, default `127.0.0.1:2501-2503` | `VITE_CALIMERO_CLUSTER` (required) via the node directory; `VITE_CALIMERO_ZONE`, `VITE_CALIMERO_DIRECTORY` |
| trust | mock quotes (`allowMock`) | signed mero-tee release `>= VITE_CALIMERO_MIN_RELEASE` (required) |
| instances from | `VITE_CALIMERO_BUNDLE` (written by `pnpm dev:local`) | the package (`VITE_CALIMERO_PACKAGE`, `VITE_CALIMERO_VERSION`) |

On a page the cluster serves from the app's bundle (the production frontend:
the only origin a Cloud node trusts for an app's passkey ceremonies besides its
own), `withServedNodes` takes the cluster's API URLs from
`/.well-known/calimero.json` instead of the directory, which that page's CSP
does not allow. A misconfigured production build throws `ConfigError` instead of connecting
anywhere. Sessions are stored per app and per target. See
[docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md).
