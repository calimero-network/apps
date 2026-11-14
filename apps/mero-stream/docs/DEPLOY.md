# Deploying Mero Stream

Mero Stream is a component app ([docs/COMPONENT-APPS.md](../../../docs/COMPONENT-APPS.md)).
One artifact matters: the **bundle** (`.mpk`), which carries the contract
(`app.wasm`, a `calimero:app` component) **and the production frontend**
(`frontend-dir = "../app/dist"`).

## The frontend lives in the bundle

A Calimero Cloud node trusts passkey ceremonies only from its own origins and
from the frontends it serves from a package's bundle, each on the package's own
origin (`{label}.{apps_domain}`). So the frontend people sign in on is the one
packed into the `.mpk`; a copy on another origin (a `*.vercel.app` deploy) is
outside the relying party and cannot sign in. On a served page the node
publishes the cluster's API URLs at `/.well-known/calimero.json`, which the app
reads (`withServedNodes`).

`logic/Cargo.toml`'s `frontend` (`https://mero-stream-neon.vercel.app`) and
`app/vercel.json` remain as the registry listing's link (v1's hosted frontend);
they are not where people sign in on 1.0.

## Build

The production build needs, where the bundle's frontend is built (the release
workflow, never per developer):

| Variable | Required | Purpose |
|---|---|---|
| `VITE_CALIMERO_CLUSTER` | yes | the cluster's name in the cloud's node directory |
| `VITE_CALIMERO_MIN_RELEASE` | yes | the lowest mero-tee release a node may run |
| `VITE_CALIMERO_ZONE`, `VITE_CALIMERO_DIRECTORY` | no | zone first; another directory (staging) |
| `VITE_CALIMERO_PACKAGE`, `VITE_CALIMERO_VERSION` | no | default `com.calimero.mero-stream`, newest version |

Without the first two the app shows a configuration error at start instead of
connecting anywhere. See `app/.env.example`.

```bash
pnpm -F mero-stream build
meroctl app pack apps/mero-stream/logic --key <production key> --app-version <x.y.z>
meroctl app inspect apps/mero-stream/logic/dist/com.calimero.mero-stream-<x.y.z>.mpk
```

Without `--key`, the well-known development key signs instead (fine on
`merod local`, refused by the registry).

## Known gap

mero-js verifies a Cloud node's release against `cloud.calimero.network`
(the signed `published-mrtds.json` and Intel collateral mirrors), but a
bundle-served page's CSP lists only the cluster's API origins, so those fetches
are refused there. Until core adds the mirror to that CSP (or the node proxies
it), a production frontend needs `policy.fetchCollateral` / `verifyQuote`
supplied some other way. `merod local` is unaffected.
