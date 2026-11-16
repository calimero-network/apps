/**
 * Creates a workspace in each app on a real Calimero Cloud cluster, the way a
 * person does from a page the cluster serves.
 *
 * A session opened on an app's frontend is bound to that package, so core
 * refuses it `POST /orgs`: the shared create-workspace dialog sends the person
 * to the node's own consent page in a pop-up. This serves the LOCAL production
 * build of an app at its real Cloud origin (the HTML and assets come from
 * `dist`, `/.well-known/calimero.json` and every API call from the cluster), so
 * the session is genuinely package-bound, then signs up a fresh passkey
 * account, walks names -> review -> approval on the node, and expects the new
 * workspace to be open.
 *
 * Opt in with `CREATE_WORKSPACE_E2E=1` (it needs production builds made with
 * `VITE_CALIMERO_MIN_RELEASE`); `E2E_APPS` picks apps (default: all),
 * `E2E_DIST_<APP>` a build directory, `E2E_SHOTS` where screenshots go.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { appUrl } from "@calimero-apps/connect";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SHOTS = process.env.E2E_SHOTS ?? join(REPO, "test-results", "create-workspace");

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

interface App {
  name: string;
  /** The package whose Cloud origin serves the page (the session is bound to it). */
  package: string;
  /** The production build to serve there. */
  dist: string;
  /** What the app shows once signed in with no workspace: the way to create one. */
  signedIn: (page: Page) => ReturnType<Page["locator"]>;
  openCreate: (page: Page) => Promise<void>;
  /** Visible once the new workspace is open. */
  opened: (page: Page, workspace: string) => ReturnType<Page["locator"]>;
  /** The package the app itself runs, when it differs from the origin's (a stand-in build). */
  standIn?: string;
}

const APPS_DIR = join(REPO, "apps");
const dist = (app: string) => process.env[`E2E_DIST_${app.toUpperCase().replace(/-/g, "_")}`] ?? join(APPS_DIR, app, "app", "dist");

const APPS: App[] = [
  {
    name: "mero-crm",
    package: "com.calimero.mero-crm",
    dist: dist("mero-crm"),
    signedIn: (p) => p.getByTestId("ns-empty-state"),
    openCreate: (p) => p.getByTestId("ns-create-btn").click(),
    opened: (p, w) => p.getByText(w).first(),
  },
  {
    name: "mero-chat",
    package: "com.calimero.chat",
    dist: dist("mero-chat"),
    signedIn: (p) => p.getByText("Welcome to MeroChat"),
    openCreate: (p) => p.getByRole("button", { name: "Create workspace" }).click(),
    opened: (p) => p.getByRole("navigation", { name: "Main navigation" }),
  },
  {
    name: "mero-issue-tracker",
    package: "com.calimero.mero-crm",
    standIn: "com.calimero.mero-issue-tracker",
    dist: dist("mero-issue-tracker"),
    signedIn: (p) => p.getByTestId("ns-empty-state"),
    openCreate: (p) => p.getByTestId("ns-create-btn").click(),
    opened: (p, w) => p.getByText(w).first(),
  },
  {
    name: "mero-docs",
    package: "com.calimero.mero-crm",
    standIn: "com.calimero.mero-drive-docs",
    dist: dist("mero-docs"),
    signedIn: (p) => p.getByRole("button", { name: /workspace/i }).first(),
    openCreate: async (p) => {
      await p.getByTestId("workspace-switcher").click();
      await p.getByRole("menuitem", { name: /New workspace/i }).click();
    },
    opened: (p, w) => p.getByTestId("workspace-switcher").filter({ hasText: w }),
  },
];

/** Answers the page's own files from `dist`, keeping the real response's headers (its CSP included). */
async function serveLocally(context: BrowserContext, origin: string, version: string, dir: string) {
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

/** The same passkey on the pop-up's own authenticator: a virtual one belongs to one page target. */
async function copyPasskey(from: { cdp: CDPSession; authenticatorId: string }, popup: Page) {
  const to = await virtualAuthenticator(popup);
  const { credentials } = await from.cdp.send("WebAuthn.getCredentials", { authenticatorId: from.authenticatorId });
  for (const credential of credentials) {
    await to.cdp.send("WebAuthn.addCredential", { authenticatorId: to.authenticatorId, credential });
  }
}

/** What the page logged as an error, kept for the report. */
const consoleLines: string[] = [];

test.afterEach(async ({}, info) => {
  await info.attach("browser-log.txt", { body: consoleLines.join("\n") || "(nothing)", contentType: "text/plain" });
});

const only = process.env.E2E_APPS?.split(/[\s,]+/).filter(Boolean);

for (const app of APPS.filter((a) => process.env.CREATE_WORKSPACE_E2E === "1" && (!only || only.includes(a.name)))) {
  test(`${app.name} creates a workspace on the cluster serving ${app.package}`, async ({ page, context }) => {
    const shots = join(SHOTS, app.name);
    mkdirSync(shots, { recursive: true });
    let n = 0;
    const shot = async (what: string, target: Page = page) => {
      await target.screenshot({ path: join(shots, `${String(++n).padStart(2, "0")}-${what}.png`), fullPage: false });
    };
    consoleLines.length = 0;
    page.on("console", (m) => m.type() === "error" && consoleLines.push(m.text()));
    page.on("pageerror", (e) => consoleLines.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (r) => consoleLines.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));

    const origin = new URL(appUrl(app.package)).origin;
    const manifest = (await (await page.request.get(`${origin}/.well-known/calimero.json`)).json()) as { versions: string[] };
    const version = manifest.versions[0]!;
    expect(existsSync(join(app.dist, "index.html")), `no production build at ${app.dist}`).toBe(true);
    await serveLocally(context, origin, version, app.dist);

    const auth = await virtualAuthenticator(page);
    await test.step("open the served page and sign up with a new passkey", async () => {
      await page.goto(`${origin}/${version}/`, { waitUntil: "domcontentloaded" });
      const signUp = page.getByTestId("signup-passkey");
      if (!(await signUp.isVisible())) await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
      await expect(signUp).toBeVisible({ timeout: 60_000 });
      await shot("signed-out");
      await signUp.click();
      if (await page.getByTestId("signup-name").isVisible()) await signUp.click();
      const approve = page.locator('[data-testid="signup-approve"]:enabled');
      await expect(approve.or(app.signedIn(page)).first()).toBeVisible({ timeout: 120_000 });
      if (await approve.isVisible()) await approve.click();
      await expect(app.signedIn(page)).toBeVisible({ timeout: 120_000 });
      await shot("signed-in");
    });

    const workspace = `E2E ${app.name} ${Date.now().toString(36)}`;
    await test.step("names", async () => {
      await app.openCreate(page);
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.locator("input").nth(0).fill(workspace);
      await dialog.locator("input").nth(1).fill("Ada");
      await shot("names");
      await dialog.getByRole("button", { name: /Continue/ }).click();
    });

    await test.step("review", async () => {
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Where it runs")).toBeVisible({ timeout: 90_000 });
      await expect(dialog.getByText(app.standIn ?? app.package, { exact: false }).or(dialog.getByText(app.package)).first()).toBeVisible();
      await expect(dialog.getByText("What it can do")).toBeVisible();
      await expect(dialog.getByText(/Loading what this app can do/)).toHaveCount(0, { timeout: 60_000 });
      await expect(dialog.getByRole("button", { name: "Create workspace" })).toBeEnabled({ timeout: 90_000 });
      await shot("review");
    });

    let popup!: Page;
    await test.step("create, and approve on the node in the pop-up", async () => {
      const opened = context.waitForEvent("page");
      await page.getByRole("dialog").getByRole("button", { name: "Create workspace" }).click();
      popup = await opened;
      await copyPasskey(auth, popup);
      await expect(page.getByRole("dialog").getByText(/[A-Z0-9]{3}-[A-Z0-9]{3}/).first()).toBeVisible({ timeout: 60_000 });
      await shot("waiting-for-approval");
      await popup.waitForLoadState("domcontentloaded");
      const approveButton = popup.getByRole("button", { name: /Approve/i });
      await expect(approveButton).toBeVisible({ timeout: 90_000 });
      await expect(popup.getByText(/Loading what you are asked to approve/)).toHaveCount(0, { timeout: 60_000 });
      await shot("node-consent-page", popup);
      const closed = popup.waitForEvent("close", { timeout: 120_000 });
      await approveButton.click();
      await closed;
    });

    await test.step("the pop-up closed and the new workspace is open", async () => {
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 120_000 });
      await expect(app.opened(page, workspace)).toBeVisible({ timeout: 120_000 });
      await shot("workspace-open");
    });

    if (app.name === "mero-chat") {
      await test.step("#general exists and the shield sits in the header", async () => {
        await expect(page.getByText("general", { exact: true }).first(), "#general was not made").toBeVisible({ timeout: 60_000 });
        const header = page.getByRole("navigation", { name: "Main navigation" });
        await expect(header.getByRole("button", { name: /node/i }).first()).toBeVisible();
        await expect(page.locator(".cp-shield"), "one shield, in the header").toHaveCount(1);
        await expect(header.locator(".cp-shield")).toHaveCount(1);
        await page.screenshot({ path: join(shots, `${String(++n).padStart(2, "0")}-header-with-shield.png`), clip: { x: 0, y: 0, width: 1280, height: 70 } });
      });
    }

    await test.step("no page errors", () => {
      expect(consoleLines.filter((l) => /pageerror/.test(l)), consoleLines.join("\n")).toEqual([]);
    });
  });
}
