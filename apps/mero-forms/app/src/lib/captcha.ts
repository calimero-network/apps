import { CAPTCHA_ACTION, type CaptchaPass } from "./captchaVerifier";

/**
 * The page's side of the captcha: Cloudflare Turnstile's widget, and the
 * verifier at `/api/captcha` that turns a solved widget into a pass the
 * contract accepts (see `captchaVerifier.ts`).
 */

export interface CaptchaConfig {
  /** Turnstile's public site key, for the widget. */
  siteKey: string;
  /** The verifier's ed25519 public key, hex: what a form saves to require a captcha. */
  publicKey: string;
}

/**
 * The `captcha_key` that has the contract check the Turnstile token itself,
 * with the team's own secret (sealed to the namespace's TEE).
 */
export const NODE_VERIFIES_TURNSTILE = "turnstile";

/** Where the verifier is: this deployment's own `/api/captcha`. */
const VERIFIER = "/api/captcha";

async function answer<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `the captcha service answered ${res.status}`);
  return body as T;
}

/** The verifier's config, or an error when this deployment has none. */
export async function fetchCaptchaConfig(): Promise<CaptchaConfig> {
  return answer<CaptchaConfig>(await fetch(VERIFIER));
}

/** Exchanges a solved widget's token for a pass bound to this form, link and nonce. */
export async function requestPass(req: { token: string; formId: string; link: string; nonce: string }): Promise<CaptchaPass> {
  return answer<CaptchaPass>(
    await fetch(VERIFIER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),
  );
}

interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("the captcha did not load")));
    script.onerror = () => {
      loading = null;
      reject(new Error("the captcha did not load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Renders the widget into `el`, bound to `nonce`, and calls `onToken` when it
 * is solved. Returns a function that removes it.
 */
export async function mountCaptcha(
  el: HTMLElement,
  siteKey: string,
  nonce: string,
  onToken: (token: string) => void,
  onExpired: () => void,
): Promise<() => void> {
  const turnstile = await loadTurnstile();
  const id = turnstile.render(el, {
    sitekey: siteKey,
    action: CAPTCHA_ACTION,
    // Echoed back by Cloudflare's siteverify, so the verifier can tell this
    // token was solved for this nonce and no other.
    cData: nonce,
    callback: onToken,
    "expired-callback": onExpired,
  });
  return () => turnstile.remove(id);
}
