/**
 * Mint a test account and a certified device offline — what the wallet does at
 * enrolment — and print the delegated credential mero-react keeps in
 * sessionStorage (`calimero.delegated.connection`).
 *
 * The same steps as poc/local-relay-rig/data/mint-chat.mts, against the
 * mero-js this app installs, so the certificate is signed at the schema the
 * app under test signs at.
 *
 * Usage: node scripts/mint-account.mjs > <out.json>
 * (MERO_JS_PATH=<a built mero-js checkout> mints with that one, as the page does.)
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { generateAccountRoot, mintDeviceId, signDeviceCert } = await import(
  process.env.MERO_JS_PATH
    ? pathToFileURL(resolve(process.env.MERO_JS_PATH, 'dist/index.mjs')).href
    : '@calimero-network/mero-js'
);

const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

const root = await generateAccountRoot();
const sign = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const agree = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
const signPk = hex(await crypto.subtle.exportKey('raw', sign.publicKey));
// pkcs8 for an Ed25519/X25519 key is a 16-byte header and the 32-byte seed.
const signSk = hex((await crypto.subtle.exportKey('pkcs8', sign.privateKey)).slice(16));
const kemPk = hex(await crypto.subtle.exportKey('raw', agree.publicKey));
const device = await mintDeviceId(root.accountId, crypto.getRandomValues(new Uint8Array(16)));
const credential = await signDeviceCert({
  rootSecret: root.secret,
  device,
  signPublicKey: signPk,
  kemPublicKey: kemPk,
  deviceEpoch: 1,
});

console.log(JSON.stringify({ account: root.accountId, credential, deviceSecret: signSk }));
