#!/usr/bin/env node
// Test vectors for the native Mero Pass crypto, produced by the web's own code.
//
//   node --experimental-transform-types apps/mero-pass/mobile/test-vectors/generate.mjs
//
// Runs the real `@calimero-network/mero-pass` library (packages/mero-pass/src)
// and the app's recovery-code, share-link, TOTP and strength helpers
// (apps/mero-pass/app/src/lib) under Node, with every random input replaced by
// a fixed one: device keys, ephemeral wrap keys, vault keys, nonces and salts.
// The output, vectors.json, is what the iOS (PassCore) and Android (core)
// crypto are asserted against, both ways: what they seal must equal what the
// web sealed byte for byte, and what the web sealed must open natively.
//
// Needs Node 22.12+ (type stripping, `module.registerHooks`). No npm install:
// the modules it imports use only WebCrypto, and the few app imports that
// reach further (`./vaults`, `./servedByNode`) are stubbed below because the
// functions used here never call them.
//
// Regenerate after any change to the crypto, and commit vectors.json.

import { createECDH, webcrypto } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const lib = join(repo, 'packages/mero-pass/src');
const appLib = join(repo, 'apps/mero-pass/app/src/lib');

// ── Module resolution: the TypeScript sources, as the app's bundler sees them ──

const STUBS = {
  './vaults':
    'export const forEachJoinedVault = () => { throw new Error("stub"); };' +
    'export const forEachOpenVault = () => { throw new Error("stub"); };',
  './servedByNode': 'export const nodeBasename = () => "/";',
};

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@calimero-network/mero-pass') {
      return { url: pathToFileURL(join(lib, 'index.ts')).href, shortCircuit: true };
    }
    if (STUBS[specifier]) {
      return {
        url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}`,
        shortCircuit: true,
      };
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const base = fileURLToPath(new URL(specifier, context.parentURL));
      const ts = base.replace(/\.js$/, '.ts');
      if (ts !== base && existsSync(ts)) {
        return { url: pathToFileURL(ts).href, shortCircuit: true };
      }
      if (!/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) {
        return { url: pathToFileURL(`${base}.ts`).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
});

// ── Fixed randomness ─────────────────────────────────────────────────────────
//
// `crypto.ts` reads `globalThis.crypto.subtle` once at load and calls
// `globalThis.crypto.getRandomValues` per call, so both go through this
// stand-in, installed before anything is imported. Queued values are handed
// out first; with the queues empty it is the real thing.

const realSubtle = webcrypto.subtle;
const randomQueue = [];
const keyPairQueue = [];

const subtle = new Proxy(realSubtle, {
  get(target, prop) {
    if (prop === 'generateKey') {
      return async (alg, extractable, usages) => {
        if (alg?.name === 'ECDH' && keyPairQueue.length) {
          return importPair(keyPairQueue.shift(), extractable);
        }
        return target.generateKey(alg, extractable, usages);
      };
    }
    const v = target[prop];
    return typeof v === 'function' ? v.bind(target) : v;
  },
});

Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: {
    subtle,
    getRandomValues(arr) {
      if (randomQueue.length) {
        const next = randomQueue.shift();
        if (next.length !== arr.length) {
          throw new Error(`queued ${next.length} random bytes, asked for ${arr.length}`);
        }
        arr.set(next);
        return arr;
      }
      return webcrypto.getRandomValues(arr);
    },
    randomUUID: () => webcrypto.randomUUID(),
  },
});

const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const b64 = (b) => Buffer.from(b).toString('base64');
const b64url = (b) => Buffer.from(b).toString('base64url');

/** A P-256 key pair from a fixed scalar. */
function fixedKey(dHex) {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(dHex, 'hex'));
  const pub = new Uint8Array(ecdh.getPublicKey());
  return { d: unhex(dHex), publicRaw: pub };
}

async function importPair(k, extractable = false) {
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: b64url(k.d),
    x: b64url(k.publicRaw.slice(1, 33)),
    y: b64url(k.publicRaw.slice(33)),
  };
  const privateKey = await realSubtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    extractable,
    ['deriveBits'],
  );
  const publicKey = await realSubtle.importKey(
    'raw',
    k.publicRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  return { privateKey, publicKey };
}

/** Deterministic bytes: `n` bytes counting up from `seed`. */
function bytes(n, seed) {
  return Uint8Array.from({ length: n }, (_, i) => (seed + i * 7) & 0xff);
}

const mp = await import('@calimero-network/mero-pass');
const recovery = await import(pathToFileURL(join(appLib, 'recoveryKey.ts')).href);
const share = await import(pathToFileURL(join(appLib, 'shareLink.ts')).href);
const totp = await import(pathToFileURL(join(appLib, 'totp.ts')).href);
const health = await import(pathToFileURL(join(appLib, 'health.ts')).href);

// ── Devices ──────────────────────────────────────────────────────────────────

const DEVICE_SCALARS = {
  alice: '1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a7988',
  bob: '0a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20212223242526272829',
  recovery: '7c6b5a4938271605f4e3d2c1b0a99887766554433221100ffeeddccbbaa99887',
};
const EPHEMERAL_SCALARS = [
  '2222222222222222222222222222222222222222222222222222222222222222',
  '3141592653589793238462643383279502884197169399375105820974944592',
  '6a09e667f3bcc908bb67ae8584caa73b3c6ef372fe94f82ba54ff53a510e527f',
];

const devices = {};
const deviceKeys = {};
for (const [name, d] of Object.entries(DEVICE_SCALARS)) {
  const k = fixedKey(d);
  deviceKeys[name] = k;
  devices[name] = {
    d: d,
    publicRaw: b64(k.publicRaw),
    fingerprint: await mp.fingerprintOf(k.publicRaw),
    confirmationCode: mp.confirmationCode(await mp.fingerprintOf(k.publicRaw)),
  };
}

// ── Vault keys ───────────────────────────────────────────────────────────────

async function vaultKey(seed) {
  randomQueue.push(bytes(32, seed));
  return mp.generateVaultKey();
}
const k1 = await vaultKey(11);
const k2 = await vaultKey(200);
const vaultKeys = [k1, k2].map((k) => ({ raw: b64(k.raw), keyId: k.keyId }));

// ── Key wraps ────────────────────────────────────────────────────────────────

const wraps = [];
const wrapCases = [
  { key: k1, to: 'alice', eph: 0, ivSeed: 40 },
  { key: k1, to: 'bob', eph: 1, ivSeed: 90 },
  { key: k2, to: 'recovery', eph: 2, ivSeed: 140 },
];
for (const c of wrapCases) {
  const eph = fixedKey(EPHEMERAL_SCALARS[c.eph]);
  const iv = bytes(12, c.ivSeed);
  keyPairQueue.push(eph);
  randomQueue.push(iv);
  const envelope = await mp.wrapVaultKey(c.key, deviceKeys[c.to].publicRaw);
  // The web opens what it wrote: the vector is only kept if it round-trips.
  const device = {
    privateKey: (await importPair(deviceKeys[c.to])).privateKey,
    publicRaw: deviceKeys[c.to].publicRaw,
  };
  const back = await mp.unwrapVaultKey(envelope, c.key.keyId, device);
  if (!back || back.keyId !== c.key.keyId) throw new Error('wrap did not round-trip');
  wraps.push({
    keyRaw: b64(c.key.raw),
    keyId: c.key.keyId,
    recipient: c.to,
    ephemeralD: EPHEMERAL_SCALARS[c.eph],
    ephemeralPublic: b64(eph.publicRaw),
    iv: b64(iv),
    envelope,
  });
}

// Wraps that must NOT open: wrong key id, wrong device, tampered ciphertext.
const goodWrap = wraps[0];
const tampered = JSON.parse(goodWrap.envelope);
tampered.ct = b64(Buffer.from(tampered.ct, 'base64').map((b, i) => (i === 3 ? b ^ 1 : b)));
const wrapRejects = [
  { why: 'key id does not match', envelope: goodWrap.envelope, keyId: k2.keyId, recipient: 'alice' },
  { why: 'addressed to another device', envelope: goodWrap.envelope, keyId: k1.keyId, recipient: 'bob' },
  { why: 'ciphertext altered', envelope: JSON.stringify(tampered), keyId: k1.keyId, recipient: 'alice' },
  { why: 'unknown version', envelope: JSON.stringify({ ...JSON.parse(goodWrap.envelope), v: 2 }), keyId: k1.keyId, recipient: 'alice' },
  { why: 'not JSON', envelope: 'nonsense', keyId: k1.keyId, recipient: 'alice' },
];
for (const r of wrapRejects) {
  const k = deviceKeys[r.recipient];
  const dev = { privateKey: (await importPair(k)).privateKey, publicRaw: k.publicRaw };
  if ((await mp.unwrapVaultKey(r.envelope, r.keyId, dev)) !== null) {
    throw new Error(`reject case opened: ${r.why}`);
  }
}

// ── Field sealing ────────────────────────────────────────────────────────────

const SECRET_ID = 'secret_00112233445566778899aabbccddeeff';
const fieldCases = [
  { key: k1, secretId: SECRET_ID, field: 'name', plaintext: 'GitHub' },
  { key: k1, secretId: SECRET_ID, field: 'tags', plaintext: JSON.stringify(['work', 'infra']) },
  { key: k1, secretId: SECRET_ID, field: 'password', plaintext: 'c0rrect horse battery staple!' },
  { key: k1, secretId: SECRET_ID, field: 'notes', plaintext: 'Línea uno\nZweite Zeile — ünïcödé 🔐 漢字\ttab' },
  { key: k2, secretId: 'secret_ffeeddccbbaa99887766554433221100', field: 'private_key', plaintext: '-----BEGIN KEY-----\n' + 'A'.repeat(900) + '\n-----END KEY-----' },
  { key: k2, secretId: 'secret_ffeeddccbbaa99887766554433221100', field: 'cvv', plaintext: '0' },
];
const fields = [];
let ivSeed = 1;
for (const c of fieldCases) {
  const iv = bytes(12, ivSeed);
  ivSeed += 23;
  randomQueue.push(iv);
  const envelope = await mp.sealField(c.key, c.secretId, c.field, c.plaintext);
  const ring = new mp.Keyring();
  ring.add(c.key);
  if ((await mp.openField(ring, c.secretId, c.field, envelope)) !== c.plaintext) {
    throw new Error('field did not round-trip');
  }
  fields.push({
    keyRaw: b64(c.key.raw),
    keyId: c.key.keyId,
    secretId: c.secretId,
    field: c.field,
    plaintext: c.plaintext,
    iv: b64(iv),
    envelope,
  });
}
if ((await mp.sealField(k1, SECRET_ID, 'password', '')) !== '') throw new Error('empty');

const pw = fields[2];
const fieldRejects = [
  { why: 'moved to another field', secretId: pw.secretId, field: 'username', envelope: pw.envelope },
  { why: 'moved to another secret', secretId: 'secret_0000', field: pw.field, envelope: pw.envelope },
  { why: 'not an envelope', secretId: pw.secretId, field: pw.field, envelope: 'plaintext' },
  { why: 'sealed under a key not held', secretId: pw.secretId, field: pw.field, envelope: pw.envelope.replace(k1.keyId, 'ab'.repeat(32)) },
];
for (const r of fieldRejects) {
  const ring = new mp.Keyring();
  ring.add(k1);
  ring.add(k2);
  let opened = true;
  try {
    await mp.openField(ring, r.secretId, r.field, r.envelope);
  } catch (e) {
    if (!(e instanceof mp.SealError)) throw e;
    opened = false;
  }
  if (opened) throw new Error(`reject case opened: ${r.why}`);
}

// ── Recovery codes ───────────────────────────────────────────────────────────

const recoveryCodes = [];
for (const name of ['recovery', 'alice']) {
  const k = deviceKeys[name];
  const fp = devices[name].fingerprint;
  const raw = new Uint8Array(35);
  raw.set(k.d);
  raw.set(unhex(fp.slice(0, 6)), 32);
  const code = recovery.encodeRecoveryCode(raw);
  const pair = await recovery.recoveryPairFrom(code, [
    { fingerprint: fp, public_key: b64(k.publicRaw), kind: 'recovery' },
  ]);
  if (!pair || pair.fingerprint !== fp) throw new Error('recovery did not round-trip');
  recoveryCodes.push({ device: name, d: hex(k.d), fingerprint: fp, code });
}
// Forgiving input: lower case, spaces instead of dashes, O for 0 and I/L for 1.
const sloppy = recoveryCodes[0].code
  .toLowerCase()
  .replace(/-/g, ' ')
  .replace(/0/g, 'o')
  .replace(/1/g, 'l');
if (hex(recovery.decodeRecoveryCode(sloppy)) !== hex(recovery.decodeRecoveryCode(recoveryCodes[0].code))) {
  throw new Error('sloppy recovery code');
}

// ── Share links ──────────────────────────────────────────────────────────────

const shared = {
  name: 'Office wifi',
  kind: 'login',
  fields: { username: 'guest', password: 'pä$$wörd 🔑' },
  expiresAt: 1_900_000_000_000,
};
randomQueue.push(bytes(12, 3), bytes(32, 77));
const keyFragment = await share.createShareFragment(shared);
randomQueue.push(bytes(12, 5), bytes(16, 99));
const passFragment = await share.createShareFragment(shared, 'tell-them-by-phone');
const now = 1_800_000_000_000;
for (const [frag, pass] of [[keyFragment, undefined], [passFragment, 'tell-them-by-phone']]) {
  const back = await share.openShareFragment(frag, pass, now);
  if (JSON.stringify(back) !== JSON.stringify(shared)) throw new Error('share did not round-trip');
}
const shareLinks = [
  { fragment: keyFragment, passphrase: null, now, secret: shared, iv: b64(bytes(12, 3)), key: b64(bytes(32, 77)) },
  { fragment: passFragment, passphrase: 'tell-them-by-phone', now, secret: shared, iv: b64(bytes(12, 5)), salt: b64(bytes(16, 99)) },
];
const shareRejects = [
  { why: 'expired', fragment: keyFragment, passphrase: null, now: 1_950_000_000_000, error: 'This link has expired.' },
  { why: 'wrong passphrase', fragment: passFragment, passphrase: 'not-it', now, error: 'Wrong passphrase, or the link was altered.' },
  { why: 'not a share link', fragment: 'v=2&iv=AA&d=AA', passphrase: null, now, error: 'This is not a Mero Pass share link.' },
];
for (const r of shareRejects) {
  let message = null;
  try {
    await share.openShareFragment(r.fragment, r.passphrase ?? undefined, r.now);
  } catch (e) {
    message = e.message;
  }
  if (message !== r.error) throw new Error(`share reject ${r.why}: ${message}`);
}

// ── TOTP ─────────────────────────────────────────────────────────────────────

const RFC_SEED_SHA1 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
const RFC_SEED_SHA256 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
const RFC_SEED_SHA512 =
  'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA';
const totpInputs = [
  RFC_SEED_SHA1,
  'jbsw y3dp ehpk 3pxp',
  `otpauth://totp/ACME%20Co:alice@example.com?secret=${RFC_SEED_SHA256}&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=30`,
  `otpauth://totp/bob?secret=${RFC_SEED_SHA512}&algorithm=SHA512&digits=8&period=60`,
];
const totpTimes = [59_000, 1_111_111_109_000, 1_234_567_890_000, 2_000_000_000_000];
const totpVectors = [];
for (const input of totpInputs) {
  const params = totp.parseTotp(input);
  for (const at of totpTimes) {
    totpVectors.push({
      input,
      atMs: at,
      code: await totp.totpCode(params, at),
      secondsRemaining: totp.secondsRemaining(params.period, at),
      digits: params.digits,
      period: params.period,
      algorithm: params.algorithm,
      issuer: params.issuer ?? null,
      account: params.account ?? null,
    });
  }
}
const totpInvalid = ['', 'not base32!', 'otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP', 'otpauth://totp/x?issuer=nope'];
for (const bad of totpInvalid) {
  if (totp.parseTotp(bad) !== null) throw new Error(`totp should reject ${bad}`);
}

// ── Password strength ────────────────────────────────────────────────────────

const strength = [
  '',
  'password',
  'aaaaaaaaaaaa',
  'abc',
  'abcdefgh',
  'Abcdefgh1',
  'abcdefghijkl',
  'Abcdefghijk1!',
  'correcthorsebatterystaple',
  'Tr0ub4dor&3xtraLong!',
].map((p) => ({ password: p, score: health.strengthOf(p) }));

// ── Out ──────────────────────────────────────────────────────────────────────

const out = {
  about:
    'Generated by generate.mjs from packages/mero-pass and apps/mero-pass/app/src/lib. ' +
    'Binary values are standard base64 unless named *Hex or d (hex). Do not edit by hand.',
  devices,
  vaultKeys,
  wraps,
  wrapRejects,
  fields,
  fieldRejects,
  recoveryCodes,
  recoverySloppyInput: sloppy,
  shareLinks,
  shareRejects,
  totp: totpVectors,
  totpInvalid,
  strength,
};
const target = join(here, 'vectors.json');
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${target}`);
