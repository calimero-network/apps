import type { Browser, BrowserContext, Page } from "@playwright/test";

import type { BrowserCredential } from "../../packages/merod-local/src/soft-passkey.ts";

export interface Browsing {
  context: BrowserContext;
  page: Page;
}

/**
 * A browser for one person: Chromium's virtual authenticator answers every
 * passkey ceremony and step-up without a prompt. `credential` puts a passkey
 * made elsewhere into it (the same account then signs in from any origin).
 */
export async function browse(browser: Browser, credential?: BrowserCredential): Promise<Browsing> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
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
  if (credential) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
  return { context, page };
}
