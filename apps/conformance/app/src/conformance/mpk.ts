/**
 * A signed single-service `.mpk` made from the built component, so the matrix
 * can install two releases of its own package (`uploadPackage`) and upgrade an
 * app and an org between them: the 1.0 counterpart of the 0.x rig bundling
 * scaffolding-e2e twice (`--app-version 0.0.1`).
 *
 * Signed the way core's `calimero-bundle` signs (`sign_manifest_json`):
 * `signerId` is the key's `did:key`, the signature is Ed25519 over
 * `SHA-256("calimero.bundle.manifest.v1\0" || JCS(manifest))` with `signature`
 * left out, and the archive is a gzipped tar of `manifest.json` and `app.wasm`.
 * After mero-js's `tests/cloud-v2/mpk.ts` (MIT), on WebCrypto and
 * `CompressionStream` so it runs in the page and in Node alike. A fresh key per
 * run: a development cluster takes any signer, and a package is bound to the
 * first key that releases it.
 */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const enc = new TextEncoder();

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** RFC 8785 for what a manifest holds: objects, arrays, strings, integers, booleans. */
export function jcs(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${jcs(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function ascii(block: Uint8Array, at: number, text: string): void {
  block.set(enc.encode(text), at);
}

/** A ustar archive of `entries`. */
export function tar(entries: Array<[string, Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, body] of entries) {
    const h = new Uint8Array(512);
    ascii(h, 0, name);
    ascii(h, 100, "0000644\0");
    ascii(h, 108, "0000000\0");
    ascii(h, 116, "0000000\0");
    ascii(h, 124, `${body.length.toString(8).padStart(11, "0")}\0`);
    ascii(h, 136, "00000000000\0");
    ascii(h, 148, "        ");
    ascii(h, 156, "0");
    ascii(h, 257, "ustar\0");
    ascii(h, 263, "00");
    const sum = h.reduce((a, b) => a + b, 0);
    ascii(h, 148, `${sum.toString(8).padStart(6, "0")}\0 `);
    parts.push(h, body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", concat(parts) as BufferSource));
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export interface Publisher {
  privateKey: CryptoKey;
  publicKey: Uint8Array;
  signerId: string;
}

/** A fresh Ed25519 package signing key. */
export async function publisher(): Promise<Publisher> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    privateKey: pair.privateKey,
    publicKey: raw,
    signerId: `did:key:z${base58(new Uint8Array([0xed, 0x01, ...raw]))}`,
  };
}

/** What the manifest's signature signs: `SHA-256(domain || JCS(manifest))`. */
export function signedPayload(manifest: Record<string, unknown>): Promise<Uint8Array> {
  return sha256(enc.encode("calimero.bundle.manifest.v1\0"), enc.encode(jcs(manifest)));
}

/** The manifest a release of `pkg` at `version` carries, unsigned. */
export async function manifestFor(
  pkg: string,
  version: string,
  wasm: Uint8Array,
  signerId: string,
  minRuntimeVersion: string,
): Promise<Record<string, unknown>> {
  return {
    version: "1.0",
    package: pkg,
    appVersion: version,
    signerId,
    minRuntimeVersion,
    wasm: { path: "app.wasm", hash: hex(await sha256(wasm)), size: wasm.length },
  };
}

/** `pkg@version` as a signed `.mpk` holding `wasm`. */
export async function signedMpk(
  pkg: string,
  version: string,
  wasm: Uint8Array,
  key: Publisher,
  minRuntimeVersion = "1.0.0-rc.8",
): Promise<Uint8Array> {
  const manifest = await manifestFor(pkg, version, wasm, key.signerId, minRuntimeVersion);
  const payload = await signedPayload(manifest);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, payload as BufferSource),
  );
  manifest.signature = { algorithm: "ed25519", publicKey: b64url(key.publicKey), signature: b64url(signature) };
  return gzip(tar([["manifest.json", enc.encode(JSON.stringify(manifest))], ["app.wasm", wasm]]));
}

/**
 * `wasm` with a custom section named `tag` appended: a component that runs the
 * same but hashes differently. Two releases of one package need two bundles,
 * and a raw bundle an app already runs is not a new release.
 */
export function variant(wasm: Uint8Array, tag: string): Uint8Array {
  const name = enc.encode(tag);
  if (name.length > 120) throw new Error("a variant tag is at most 120 bytes");
  return concat([wasm, new Uint8Array([0, name.length + 1, name.length]), name]);
}
