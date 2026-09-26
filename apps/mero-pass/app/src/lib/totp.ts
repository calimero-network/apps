// ── Authenticator codes (RFC 6238) ───────────────────────────────────────────
//
// The seed is a vault field like any other — sealed at rest, opened in the
// browser — and the six digits are computed here, every period, from it. No
// code or seed is ever sent anywhere.

export interface TotpParams {
  secret: string;
  digits: number;
  period: number;
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512';
  issuer?: string;
  account?: string;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error(`Not a base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/**
 * Accept either a bare base32 seed or an `otpauth://totp/...` URI (what a QR
 * code encodes). Returns null for anything that is neither.
 */
export function parseTotp(input: string): TotpParams | null {
  const text = input.trim();
  if (!text) return null;
  if (text.toLowerCase().startsWith('otpauth://')) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.host.toLowerCase() !== 'totp') return null;
    const secret = url.searchParams.get('secret');
    if (!secret) return null;
    const alg = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase();
    const algorithm =
      alg === 'SHA256' ? 'SHA-256' : alg === 'SHA512' ? 'SHA-512' : 'SHA-1';
    const label = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const [issuerFromLabel, account] = label.includes(':')
      ? label.split(':', 2)
      : [undefined, label];
    try {
      base32Decode(secret);
    } catch {
      return null;
    }
    return {
      secret,
      digits: Number(url.searchParams.get('digits') ?? 6) || 6,
      period: Number(url.searchParams.get('period') ?? 30) || 30,
      algorithm,
      issuer: url.searchParams.get('issuer') ?? issuerFromLabel,
      account: account || undefined,
    };
  }
  try {
    if (base32Decode(text).length === 0) return null;
  } catch {
    return null;
  }
  return { secret: text, digits: 6, period: 30, algorithm: 'SHA-1' };
}

/** The code for `atMs`, zero-padded to `digits`. */
export async function totpCode(
  params: TotpParams,
  atMs = Date.now(),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(base32Decode(params.secret)),
    { name: 'HMAC', hash: params.algorithm },
    false,
    ['sign'],
  );
  const counter = Math.floor(atMs / 1000 / params.period);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return (bin % 10 ** params.digits).toString().padStart(params.digits, '0');
}

/** Seconds left in the current period. */
export function secondsRemaining(period: number, atMs = Date.now()): number {
  return period - (Math.floor(atMs / 1000) % period);
}
