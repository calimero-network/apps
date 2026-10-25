import nacl from "tweetnacl";

/**
 * The captcha verifier: what `api/captcha.ts` runs on Vercel.
 *
 * The contract cannot ask Cloudflare whether a visitor passed a captcha: it
 * makes no network calls. So this function does, and signs a short pass the
 * contract checks offline with the SDK's `ed25519_verify`:
 *
 *   mero-forms/captcha/v1|<form>|<link>|<nonce>|<expires_ms>
 *
 * The nonce is the visitor's, random, and bound into the Turnstile token as
 * its `cData`, so one solved captcha yields one pass; the contract accepts
 * each nonce once. The function sees the form, the link and the nonce, never
 * the answers, and holds no form key or grant.
 *
 * Configured by three environment variables on the Vercel project:
 *
 * - `TURNSTILE_SITE_KEY`, public, handed to the page;
 * - `TURNSTILE_SECRET_KEY`, Cloudflare's, for `siteverify`;
 * - `CAPTCHA_SIGNING_SEED`, 32 bytes of hex: the ed25519 key passes are signed
 *   with. Its public half is what a form's "Require a captcha" saves.
 */

export interface VerifierEnv {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  CAPTCHA_SIGNING_SEED?: string;
}

/** What the page sends: the Turnstile token and what the pass is for. */
export interface PassRequest {
  token: string;
  formId: string;
  link: string;
  nonce: string;
}

/** What the contract's `submit_via_link` takes as `captcha`. */
export interface CaptchaPass {
  nonce: string;
  expires_ms: number;
  signature: string;
}

/** The Turnstile action the page renders the widget with. */
export const CAPTCHA_ACTION = "mero-forms-submit";

/** How long a pass is good for. The contract refuses one valid for over ten minutes. */
export const PASS_MS = 5 * 60 * 1000;

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function captchaMessage(formId: string, link: string, nonce: string, expiresMs: number): string {
  return `mero-forms/captcha/v1|${formId}|${link}|${nonce}|${expiresMs}`;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function unhex(value: string): Uint8Array | null {
  if (!/^([0-9a-f]{2})*$/i.test(value)) return null;
  return Uint8Array.from(value.match(/../g) ?? [], (b) => parseInt(b, 16));
}

/** The signing key pair, from its 32-byte seed. */
export function signingKeys(seedHex: string): nacl.SignKeyPair | null {
  const seed = unhex(seedHex.trim());
  return seed && seed.length === 32 ? nacl.sign.keyPair.fromSeed(seed) : null;
}

export function signPass(keys: nacl.SignKeyPair, req: Omit<PassRequest, "token">, now: number): CaptchaPass {
  const expires_ms = now + PASS_MS;
  // Copied into this realm's Uint8Array: tweetnacl checks `instanceof`, and
  // an encoder from another realm (a test DOM, an edge runtime) fails it.
  const message = new Uint8Array(new TextEncoder().encode(captchaMessage(req.formId, req.link, req.nonce, expires_ms)));
  return { nonce: req.nonce, expires_ms, signature: hex(nacl.sign.detached(message, keys.secretKey)) };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function parseRequest(body: unknown): PassRequest | null {
  if (!body || typeof body !== "object") return null;
  const { token, formId, link, nonce } = body as Record<string, unknown>;
  if (typeof token !== "string" || !token || token.length > 4096) return null;
  if (typeof formId !== "string" || !/^[0-9a-f]{1,64}$/.test(formId)) return null;
  if (typeof link !== "string" || !/^[0-9a-f]{64}$/.test(link)) return null;
  if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce)) return null;
  return { token, formId, link, nonce };
}

/**
 * `GET` answers the page's widget config and the public key a form saves;
 * `POST` checks a solved captcha with Cloudflare and answers a signed pass.
 */
export async function handleCaptcha(
  request: Request,
  env: VerifierEnv,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Response> {
  const keys = signingKeys(env.CAPTCHA_SIGNING_SEED ?? "");
  if (!keys || !env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY) {
    return json(503, { error: "the captcha is not set up on this deployment" });
  }
  if (request.method === "GET") {
    return json(200, { siteKey: env.TURNSTILE_SITE_KEY, publicKey: hex(keys.publicKey) });
  }
  if (request.method !== "POST") return json(405, { error: "GET or POST" });

  const req = parseRequest(await request.json().catch(() => null));
  if (!req) return json(400, { error: "token, formId, link and nonce are required" });

  const verdict = await fetchImpl(SITEVERIFY, {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: req.token }),
  })
    .then((r) => r.json() as Promise<{ success?: boolean; action?: string; cdata?: string }>)
    .catch(() => null);
  if (!verdict) return json(502, { error: "could not reach the captcha service" });
  // The token must be for this page's action and this nonce: a token solved
  // for one pass cannot be spent on another.
  if (!verdict.success || verdict.action !== CAPTCHA_ACTION || verdict.cdata !== req.nonce) {
    return json(403, { error: "the captcha was not solved" });
  }
  return json(200, signPass(keys, req, now()));
}
