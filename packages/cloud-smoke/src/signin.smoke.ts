/**
 * Signs in to apps a real Calimero Cloud cluster serves, the way a person does.
 *
 * The app and studio e2e suites run on `merod local`, whose mock quotes fetch
 * nothing, so they cannot see what a served page on a TDX cluster needs from
 * the network. core#4861 was exactly that: the served page's CSP `connect-src`
 * left out https://cloud.calimero.network, mero-js's attestation fetches
 * (`/api/tee/node-releases/{v}`, `/api/tee/pcs`) were blocked, and every
 * node-served frontend failed to sign in with "Load failed". This test opens
 * the served page, checks its CSP against the cluster's nodes and the cloud
 * mirror, then signs up a fresh passkey account (Chrome's virtual
 * authenticator), signs out, signs back in and signs out, through the app's
 * own UI.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";
import { CLOUD_MIRROR, smokeTargets, type SmokeTarget } from "./config";
import { missingConnectSources } from "./csp";

/** What a served page writes to the console that means the network was refused. */
const BLOCKED = /Content Security Policy|Refused to connect|Load failed|Failed to fetch/i;

interface WellKnown {
  package?: string;
  versions?: string[];
  api?: string[];
}

interface Observed {
  console: string[];
  violations: string[];
  failedRequests: string[];
}

/** Records console errors, page errors, failed requests and CSP violation events. */
async function observe(context: BrowserContext, page: Page): Promise<Observed> {
  const seen: Observed = { console: [], violations: [], failedRequests: [] };
  await context.exposeBinding("__smokeCspViolation", (_source, line: string) => {
    seen.violations.push(line);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      const report = (window as unknown as { __smokeCspViolation?: (line: string) => void }).__smokeCspViolation;
      report?.(`${e.effectiveDirective} blocked ${e.blockedURI} (from ${e.sourceFile || "page"})`);
    });
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") seen.console.push(msg.text());
  });
  page.on("pageerror", (err) => seen.console.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => {
    seen.failedRequests.push(`${req.method()} ${req.url()}: ${req.failure()?.errorText ?? "failed"}`);
  });
  return seen;
}

/** Chrome's CDP virtual authenticator: a platform passkey that always verifies the user. */
async function virtualAuthenticator(page: Page): Promise<{ cdp: CDPSession; authenticatorId: string }> {
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

function describe(seen: Observed): string {
  const lines = [
    ...seen.violations.map((v) => `csp violation: ${v}`),
    ...seen.console.map((c) => `console: ${c}`),
    ...seen.failedRequests.map((r) => `request failed: ${r}`),
  ];
  return lines.length ? lines.join("\n") : "(no console errors, CSP violations or failed requests)";
}

/**
 * How an app's own UI wraps the shared passkey control. Most apps show
 * `<PasskeySignIn>` straight away and a "Sign out" button once signed in;
 * an app with a landing page first, or another sign-out, says so here.
 */
interface AppFlow {
  /** Brings up the passkey control when the page does not show it on load. */
  openSignIn?: (page: Page) => Promise<void>;
  /** Visible once signed in. */
  signedIn: (page: Page) => Locator;
  signOut: (page: Page) => Promise<void>;
}

const DEFAULT_FLOW: AppFlow = {
  signedIn: (page) => page.getByRole("button", { name: "Sign out" }),
  signOut: (page) => page.getByRole("button", { name: "Sign out" }).click(),
};

const FLOWS: Record<string, AppFlow> = {
  // A landing page whose "Sign in" opens the passkey popup; signed in, the
  // workspace picker, whose "Disconnect node" signs out (back to the landing).
  "com.calimero.chat": {
    openSignIn: async (page) => {
      const control = page.getByTestId("signin-passkey");
      if (await control.isVisible()) return;
      await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
      await expect(control).toBeVisible({ timeout: 30_000 });
    },
    signedIn: (page) => page.getByRole("button", { name: "Disconnect node" }),
    signOut: (page) => page.getByRole("button", { name: "Disconnect node" }).click(),
  },
};

const flowOf = (pkg: string): AppFlow => FLOWS[pkg] ?? DEFAULT_FLOW;

/** Waits for the session to settle after a ceremony: signed in, or the control's error. */
async function ceremonyOutcome(page: Page, flow: AppFlow, what: string, seen: Observed): Promise<void> {
  const signedIn = flow.signedIn(page);
  const error = page.getByTestId("signin-error");
  await expect(signedIn.or(error).first(), `${what}: neither signed in nor an error shown`).toBeVisible({
    timeout: 120_000,
  });
  if (await error.isVisible()) {
    const message = (await error.innerText()).trim();
    const hints: string[] = [];
    if (BLOCKED.test(message) || BLOCKED.test(describe(seen))) {
      hints.push(
        "The page could not reach the network it needs: see core#4861 (the served CSP must allow " +
          `${CLOUD_MIRROR} for attestation, and every node).`,
      );
    }
    if (/sign.?up|invite|closed|not allowed to create/i.test(message) && what.startsWith("sign up")) {
      hints.push(
        "The cluster may refuse sign-ups without an invite (core#4848 policy `invite` or `closed`); " +
          "the served apps offer no invite field, so this smoke needs an `open` cluster.",
      );
    }
    throw new Error(`${what} failed in the app: "${message}"\n${hints.join("\n")}\n${describe(seen)}`);
  }
}

/** What each app shows once signed in, beyond the shared control: one call to its cluster that must work. */
const SIGNED_IN_CHECKS: Record<string, (page: Page) => Promise<void>> = {
  // StorePicker lists the account's kv-store instances (`listStores`): a
  // sealed, authenticated call to the cluster with the new session.
  "com.calimero.kv-store": async (page) => {
    await expect(page.getByRole("heading", { name: "Your stores" })).toBeVisible();
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator("pre.err"), "listing this account's stores failed").toHaveCount(0);
  },
  // The workspace picker lists the account's workspaces (its groups on the
  // cluster), a read-only authenticated call that needs no workspace yet: a
  // fresh account lands on "Welcome to MeroChat", one with workspaces on
  // "Select workspace". The chat's own view methods (`abi.json`) need a
  // workspace's app instance, which a fresh account does not have.
  "com.calimero.chat": async (page) => {
    const listed = page.getByText("Welcome to MeroChat").or(page.getByText("Select workspace"));
    const failed = page.getByText("Something went wrong");
    await expect(listed.or(failed).first(), "the workspace picker never listed workspaces").toBeVisible({
      timeout: 60_000,
    });
    await expect(failed, "listing this account's workspaces failed").toHaveCount(0);
  },
};

for (const target of smokeTargets()) {
  test(`${target.package} signs up, in and out on the cluster serving it`, async ({ page, context, request }, info) => {
    const seen = await observe(context, page);
    try {
      await run(target, page, request, seen);
    } finally {
      await info.attach("browser-log.txt", { body: describe(seen), contentType: "text/plain" });
    }
  });
}

async function run(
  target: SmokeTarget,
  page: Page,
  request: APIRequestContext,
  seen: Observed,
): Promise<void> {
  const { cdp, authenticatorId } = await virtualAuthenticator(page);
  const flow = flowOf(target.package);

  // 1. The served page.
  const response = await test.step(`open ${target.url}`, async () => {
    const res = await page.goto(target.url, { waitUntil: "domcontentloaded" });
    expect(res, `no response from ${target.url}`).not.toBeNull();
    expect(res!.status(), `${target.url} (landed on ${page.url()}) answered ${res!.status()}`).toBe(200);
    expect(res!.headers()["content-type"] ?? "").toContain("text/html");
    await expect(page.locator("#root")).toBeAttached();
    await expect(page).toHaveTitle(/\S/);
    return res!;
  });

  // 2. The CSP lets the page reach the cloud mirror and every node.
  await test.step("the served CSP allows the cloud mirror and the cluster's nodes", async () => {
    const origin = new URL(page.url()).origin;
    const wk = await request.get(`${origin}/.well-known/calimero.json`);
    expect(wk.status(), `${origin}/.well-known/calimero.json answered ${wk.status()}`).toBe(200);
    const manifest = (await wk.json()) as WellKnown;
    expect(manifest.package, "the host serves a different package").toBe(target.package);
    const nodes = manifest.api ?? [];
    expect(nodes.length, ".well-known/calimero.json lists no nodes (`api`)").toBeGreaterThan(0);

    const csp = response.headers()["content-security-policy"];
    expect(csp, `${page.url()} sends no Content-Security-Policy header`).toBeTruthy();
    const missing = missingConnectSources(csp!, [CLOUD_MIRROR, ...nodes]);
    // Soft: the sign-in below still runs, so the report shows what the
    // missing source does to a real sign-up as well.
    expect
      .soft(
        missing,
        `core#4861: the served page's CSP connect-src does not allow ${missing.join(", ")}. ` +
          `mero-js attests every node from the page (${CLOUD_MIRROR}/api/tee/node-releases/{v} and ` +
          `${CLOUD_MIRROR}/api/tee/pcs), so sign-in fails with "Load failed" (Safari) or "Failed to fetch" ` +
          `(Chromium). The cluster's merod needs the core#4861 fix.\nThe served CSP: ${csp}`,
      )
      .toEqual([]);
  });

  // The other half of attestation from a page: the mirror must answer with
  // Intel's collateral, not the cloud console's HTML. Soft, like the CSP.
  await test.step("the cloud mirror serves Intel's collateral", async () => {
    const url = `${CLOUD_MIRROR}/api/tee/pcs/sgx/certification/v4/pckcrl?ca=processor&encoding=der`;
    const res = await request.get(url, { headers: { Origin: new URL(page.url()).origin } });
    const type = res.headers()["content-type"] ?? "";
    const chain = res.headers()["sgx-pck-crl-issuer-chain"];
    expect
      .soft(
        { status: res.status(), html: type.includes("text/html"), issuerChain: Boolean(chain) },
        `${url} is not Intel's PCK CRL (status ${res.status()}, content-type ${type || "none"}, ` +
          `SGX-PCK-CRL-Issuer-Chain ${chain ? "present" : "missing"}). mero-js takes collateral for every ` +
          `node's quote from ${CLOUD_MIRROR}/api/tee/pcs; without it attestation fails with ` +
          `"Missing SGX-PCK-CRL-Issuer-Chain" even once the CSP allows the mirror.`,
      )
      .toEqual({ status: 200, html: false, issuerChain: true });
  });

  // 3. Sign up a fresh account, sign out, sign back in with the same passkey.
  await test.step("sign up with a new passkey", async () => {
    await flow.openSignIn?.(page);
    const signUp = page.getByTestId("signup-passkey");
    const cannot = page.getByRole("heading", { name: "Cannot connect" });
    await expect(signUp.or(cannot).first(), "the app never showed its sign-in").toBeVisible({ timeout: 60_000 });
    if (await cannot.isVisible()) {
      throw new Error(`the app could not connect: ${await page.locator("pre.err").innerText()}\n${describe(seen)}`);
    }
    await signUp.click();
    // `<PasskeySignIn askName>` asks for an optional name first; the second
    // press creates the passkey.
    if (await page.getByTestId("signup-name").isVisible()) await signUp.click();
    // Since core rc.10 a sign-up is two prompts: the new passkey, then one
    // approval with it. The page asks the second right away; only when the
    // browser refuses it at once does it wait for "Approve with your new
    // passkey" (enabled only then: while the prompt is open the same test id
    // is a disabled "waiting" button). Either way passes.
    const approve = page.locator('[data-testid="signup-approve"]:enabled');
    const failed = page.getByTestId("signin-error");
    await expect(approve.or(flow.signedIn(page)).or(failed).first()).toBeVisible({ timeout: 120_000 });
    if (await approve.isVisible()) await approve.click();
    await ceremonyOutcome(page, flow, "sign up", seen);
    const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
    expect(credentials.filter((c) => c.isResidentCredential).length, "no discoverable passkey was made").toBe(1);
  });

  await test.step("sign out", async () => {
    await flow.signOut(page);
    await flow.openSignIn?.(page);
    await expect(page.getByTestId("signin-passkey")).toBeVisible();
  });

  await test.step("sign in with the same passkey", async () => {
    await page.getByTestId("signin-passkey").click();
    await ceremonyOutcome(page, flow, "sign in", seen);
  });

  // 4. Signed in for real: one call to the cluster works. Then sign out.
  await test.step("a call to the cluster works", async () => {
    await SIGNED_IN_CHECKS[target.package]?.(page);
  });

  await test.step("sign out", async () => {
    await flow.signOut(page);
    await flow.openSignIn?.(page);
    await expect(page.getByTestId("signin-passkey")).toBeVisible();
  });

  await test.step("no CSP violations or blocked fetches", async () => {
    const blocked = [...seen.violations, ...seen.console.filter((line) => BLOCKED.test(line))];
    expect(blocked, `the page was refused the network (core#4861):\n${describe(seen)}`).toEqual([]);
  });
}
