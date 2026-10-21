# @calimero-network/mero-pass

How a Mero Pass vault is opened, read and written, with no browser or React
dependency: the crypto (`crypto.ts`) and the vault session (`vaultSession.ts`).
The Mero Pass app uses it, and so will an agent such as mero-bot, so both open
a vault the same way and agree on who is let in.

| | |
| --- | --- |
| `crypto.ts` | Device keys (ECDH P-256), vault keys (AES-256-GCM), key wraps (ECIES) and field sealing with the secret id and field name as associated data |
| `vaultSession.ts` | One vault: register this device, open the keys wrapped to it, approve or admit others, rotate, and seal or open every field. Talks to the contract through `VaultApi`, so tests run it against an in-memory fake |

It needs only `globalThis.crypto`, `btoa`/`atob` and `TextEncoder`, so it runs
in a browser and in Node 20+. The tests run under Node to hold it to that.

## Opening a vault as an agent

An agent registers its key as `agent` and waits until a vault admin approves
it; the contract only stores and counts an admin's wrap to an agent's key.

```ts
import { VaultSession, fingerprintOf, generateDeviceKey } from '@calimero-network/mero-pass';

const device = await generateDeviceKey(); // non-extractable: see below
const fingerprint = await fingerprintOf(device.publicRaw);
const session = new VaultSession(api, device, fingerprint, 'mero-bot', 'agent');

if ((await session.open()) === 'ready') {
  const [oauth] = (await session.list()).filter((s) => s.kind === 'oauth2');
  // oauth.fields.refresh_token is plaintext in this process only.
}
```

`api` is a `VaultApi` over the vault's context (the app builds one from its
generated client in `apps/mero-pass/app/src/lib/vaultApi.ts`). An agent
session never creates a vault key, never admits anyone and never hands a key
on. `api_key` and `oauth2` secrets carry the field names in
`apps/mero-pass/app/src/lib/secretKinds.ts`.

`generateDeviceKey` makes a non-extractable key, which a browser keeps in
IndexedDB. A Node process has nowhere to keep one across restarts, and a new
key per restart would need a new admin approval each time: an agent that runs
for long needs a way to persist its key (sealed, or inside a TEE), which this
package does not provide yet.

## Install

```sh
npm install @calimero-network/mero-pass
```

ESM and CommonJS builds with type declarations; no dependencies. In this
monorepo the app uses it as `workspace:*` and reads the TypeScript source
directly, so nothing has to be built first.

## Releasing

The version is the one in `package.json`. Bump it in the PR that changes the
package; when that PR merges, `.github/workflows/publish-mero-pass.yml` runs
the tests, builds, publishes the new version to npm with provenance (npm
trusted publishing, no stored token, as mero-js does) and tags the commit
`mero-pass-v<version>`. A push that does not change the version publishes
nothing.

**First release only.** npm lets a trusted publisher be set only on a package
that already exists. So someone with publish rights on the `@calimero-network`
npm scope publishes the first version by hand:

```sh
pnpm install && cd packages/mero-pass && pnpm build
pnpm pack                      # applies publishConfig and resolves catalog: ranges
npm publish calimero-network-mero-pass-0.1.0.tgz --access public
```

then adds `calimero-network/apps`, workflow `publish-mero-pass.yml`, as the
package's trusted publisher on npmjs.com. Every later version goes through
the workflow.
