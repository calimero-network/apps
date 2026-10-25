import nacl from "tweetnacl";
import { describe, expect, it, vi } from "vitest";
import { CAPTCHA_ACTION, PASS_MS, captchaMessage, handleCaptcha, signingKeys, type VerifierEnv } from "./captchaVerifier";

const SEED = "11".repeat(32);
const env: VerifierEnv = {
  TURNSTILE_SITE_KEY: "site-key",
  TURNSTILE_SECRET_KEY: "secret-key",
  CAPTCHA_SIGNING_SEED: SEED,
};
const body = { token: "solved", formId: "ab12", link: "cd".repeat(32), nonce: "ef".repeat(16) };
const NOW = 1_700_000_000_000;

const post = (b: unknown) =>
  new Request("https://forms.example/api/captcha", { method: "POST", body: JSON.stringify(b) });

function cloudflare(verdict: Record<string, unknown>) {
  return vi.fn(async () => new Response(JSON.stringify(verdict)));
}

describe("the captcha verifier", () => {
  it("hands the page its site key and the public key forms save", async () => {
    const res = await handleCaptcha(new Request("https://forms.example/api/captcha"), env);
    const keys = signingKeys(SEED)!;
    expect(await res.json()).toEqual({
      siteKey: "site-key",
      publicKey: Buffer.from(keys.publicKey).toString("hex"),
    });
  });

  it("signs a pass the contract can check, for this form, link and nonce only", async () => {
    const fetchImpl = cloudflare({ success: true, action: CAPTCHA_ACTION, cdata: body.nonce });
    const res = await handleCaptcha(post(body), env, fetchImpl as unknown as typeof fetch, () => NOW);
    expect(res.status).toBe(200);
    const pass = (await res.json()) as { nonce: string; expires_ms: number; signature: string };
    expect(pass.nonce).toBe(body.nonce);
    expect(pass.expires_ms).toBe(NOW + PASS_MS);

    // Cloudflare was asked with the secret and the token.
    const sent = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(sent.get("secret")).toBe("secret-key");
    expect(sent.get("response")).toBe("solved");

    const message = new Uint8Array(new TextEncoder().encode(captchaMessage(body.formId, body.link, body.nonce, pass.expires_ms)));
    const signature = Uint8Array.from(Buffer.from(pass.signature, "hex"));
    const publicKey = signingKeys(SEED)!.publicKey;
    expect(nacl.sign.detached.verify(message, signature, publicKey)).toBe(true);
    // The same signature does not cover another form.
    const other = new Uint8Array(new TextEncoder().encode(captchaMessage("ffff", body.link, body.nonce, pass.expires_ms)));
    expect(nacl.sign.detached.verify(other, signature, publicKey)).toBe(false);
  });

  it("matches the message the contract builds", () => {
    // apps/mero-forms/logic/src/lib.rs, captcha_message
    expect(captchaMessage("f1", "l1", "n1", 42)).toBe("mero-forms/captcha/v1|f1|l1|n1|42");
  });

  it("refuses a token Cloudflare did not pass, or one solved for another nonce or page", async () => {
    for (const verdict of [
      { success: false },
      { success: true, action: CAPTCHA_ACTION, cdata: "00".repeat(16) },
      { success: true, action: "login", cdata: body.nonce },
    ]) {
      const res = await handleCaptcha(post(body), env, cloudflare(verdict) as unknown as typeof fetch);
      expect(res.status).toBe(403);
    }
  });

  it("refuses a malformed request without asking Cloudflare", async () => {
    const fetchImpl = cloudflare({ success: true });
    for (const bad of [{}, { ...body, link: "short" }, { ...body, nonce: "x" }, { ...body, formId: "../" }]) {
      const res = await handleCaptcha(post(bad), env, fetchImpl as unknown as typeof fetch);
      expect(res.status).toBe(400);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("says so when the deployment has no captcha set up", async () => {
    const res = await handleCaptcha(new Request("https://forms.example/api/captcha"), {});
    expect(res.status).toBe(503);
  });
});
