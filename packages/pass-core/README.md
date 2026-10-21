# @calimero-apps/pass-core

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
import { VaultSession, fingerprintOf, generateDeviceKey } from '@calimero-apps/pass-core';

const device = await generateDeviceKey(); // keep it where the agent runs
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

## Not published yet

Like every package here it is `private` and reached as `workspace:*`. An agent
outside this monorepo needs it published (or vendored) first.
