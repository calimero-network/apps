import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { BrowserContext, CDPSession, Page } from "@playwright/test";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
};

/** Answers the page's own files from `dist`, keeping the real response's headers (its CSP included). */
export async function serveLocally(context: BrowserContext, origin: string, version: string, dir: string) {
  const root = `/${version}/`;
  await context.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith(root) || route.request().method() !== "GET") return route.fallback();
    const rel = decodeURIComponent(url.pathname.slice(root.length));
    let file = join(dir, rel);
    if (!rel || !existsSync(file) || !statSync(file).isFile()) file = join(dir, "index.html");
    const real = await route.fetch({ url: `${origin}${root}` });
    const headers = { ...real.headers() };
    delete headers["content-length"];
    delete headers["content-encoding"];
    headers["content-type"] = MIME[extname(file)] ?? "application/octet-stream";
    headers["cache-control"] = "no-store";
    await route.fulfill({ status: 200, headers, body: readFileSync(file) });
  });
}

export async function virtualAuthenticator(page: Page): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

/** The same passkey on the pop-up's own authenticator: a virtual one belongs to one page target. */
export async function copyPasskey(from: { cdp: CDPSession; authenticatorId: string }, popup: Page) {
  const to = await virtualAuthenticator(popup);
  const { credentials } = await from.cdp.send("WebAuthn.getCredentials", { authenticatorId: from.authenticatorId });
  for (const credential of credentials) {
    await to.cdp.send("WebAuthn.addCredential", { authenticatorId: to.authenticatorId, credential });
  }
}
