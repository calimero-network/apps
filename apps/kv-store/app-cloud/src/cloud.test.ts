// @vitest-environment jsdom
import { transportKeyBinding } from "@calimero-network/mero-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { allowMock, newClient, saveSession, savedSession } from "./cloud";

/** A node answering with a mock quote that binds the nonce and its key: all an impostor needs. */
function impostor(): typeof fetch {
  const key = new Uint8Array(32).fill(9);
  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname !== "/attestation") return new Response("{}", { status: 418 });
    const nonce = url.searchParams.get("nonce") ?? "";
    const suffix = await transportKeyBinding(new Uint8Array(32), key);
    const bytes = [...new TextEncoder().encode("MOCK_TDX_QUOTE_V1"), ...nonce.match(/../g)!.map((h) => parseInt(h, 16)), ...suffix];
    return Response.json({ quote: btoa(String.fromCharCode(...bytes)), transportKey: hex(key), appHash: "", nonce, mock: true });
  }) as typeof fetch;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  saveSession(null);
});

describe("a production build", () => {
  it("does not trust mock quotes unless built with VITE_CALIMERO_ALLOW_MOCK=true", () => {
    vi.stubEnv("VITE_CALIMERO_ALLOW_MOCK", "");
    expect(allowMock()).toBe(false);
    vi.stubEnv("VITE_CALIMERO_ALLOW_MOCK", "true");
    expect(allowMock()).toBe(true);
  });

  it("refuses a mock quote before it sends the sign-up anywhere", async () => {
    vi.stubEnv("VITE_CALIMERO_ALLOW_MOCK", "");
    const seen: string[] = [];
    const answer = impostor();
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new URL(String(input)).pathname);
      return answer(input, init);
    });
    await expect(newClient().post("auth/passkey/register/begin", { name: "ada" })).rejects.toThrow(/mock quote refused/);
    expect(seen).toEqual(["/attestation"]);
  });
});

describe("the session", () => {
  it("keeps the session token out of web storage", () => {
    saveSession({ accountId: "acc", sessionToken: "secret", refreshToken: "r1", expiresAt: 9e9 });
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("secret");
    expect(savedSession()?.sessionToken).toBe("secret");
  });
});
