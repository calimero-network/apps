/**
 * The byte primitives every signer in this app shares with core.
 *
 * Extracted from `warrant.ts` when the login signer arrived and needed the same
 * `domainHash`, the same integer widths and the same hex handling. Keeping one
 * copy is the entire point: these have to stay byte-identical with core's
 * `domain_hash` and borsh, and two copies drifting apart is precisely the
 * failure the conformance fixtures exist to catch — a second, subtly different
 * `domainHash` would pass its own tests and produce signatures that verify
 * nowhere.
 *
 * mero-js made the same extraction for the same reason (`crypto/internal.ts`),
 * which is a reasonable sign this is where the seam belongs.
 */

const ENCODER = new TextEncoder();

/** UTF-8 bytes. Named rather than inlined so the encoding is one decision. */
export function utf8(value: string): Uint8Array {
  return ENCODER.encode(value);
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(value: string, label: string, expectedBytes: number): Uint8Array {
  const clean = value.trim();
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length !== expectedBytes * 2) {
    throw new Error(`${label} must be ${expectedBytes * 2} hex characters, got ${clean.length}`);
  }
  const bytes = new Uint8Array(expectedBytes);
  for (let i = 0; i < expectedBytes; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, p) => total + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function u64le(value: number | bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

export function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

/**
 * core's `domain_hash`: `SHA-256(u64le(len) ‖ domain ‖ (u64le(len) ‖ part)*)`.
 *
 * The lengths are what stop two different field splits from hashing alike — and
 * they are why a part that carries its own length prefix would be counted
 * twice. See `login.ts`'s audience, which is the one place that bites.
 */
export async function domainHash(domain: Uint8Array, parts: Uint8Array[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [u64le(domain.length), domain];
  for (const part of parts) {
    chunks.push(u64le(part.length), part);
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', concat(...chunks)));
}

/**
 * Sign with a key this page cannot read.
 *
 * Wrapped so the "this browser has no Ed25519" failure is reported once, in the
 * same words, by every signer here. WebCrypto throws a bare `NotSupportedError`
 * for it, which reads like a bug in the caller rather than a missing algorithm.
 */
export async function signEd25519(key: CryptoKey, payload: Uint8Array): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, payload));
  } catch (cause) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    throw new Error(
      'this runtime has no WebCrypto Ed25519, so nothing can be signed here. ' +
        `Chrome 137+, Firefox 130+ or Safari 17+${detail}`,
    );
  }
}
