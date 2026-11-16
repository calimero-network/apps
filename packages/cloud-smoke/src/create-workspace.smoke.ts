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
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "@calimero-apps/connect";
import { copyPasskey, serveLocally, virtualAuthenticator } from "./smoke-kit";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SHOTS = process.env.E2E_SHOTS ?? join(REPO, "test-results", "create-workspace");

interface App {
  name: string;
  /** The package whose Cloud origin serves the page (the session is bound to it). */
  package: string;
  /** The production build to serve there. */
  dist: string;
  /** The landing page's way to the passkey sign-in, when it is not a "Sign in" button. */
  signIn?: (page: Page) => ReturnType<Page["locator"]>;
  /** What the app shows once signed in with no workspace: the way to create one. */
  signedIn: (page: Page) => ReturnType<Page["locator"]>;
  openCreate: (page: Page) => Promise<void>;
  /** Visible once the new workspace is open. */
  opened: (page: Page, workspace: string) => ReturnType<Page["locator"]>;
  /** Waited for before the "workspace open" screenshot, so it shows the app as a person sees it. */
  settled?: (page: Page) => Promise<void>;
  /** The package the app itself runs, when it differs from the origin's (a stand-in build). */
  standIn?: string;
  /** Page errors a stand-in build raises on its own: its instance runs CRM's contract, which has none of the app's methods. */
  standInErrors?: RegExp;
  /** The test id of the control that creates an account, when it is not `<PasskeySignIn>`'s. */
  signUpTestId?: string;
  /** The shield sits in the header bar of the app's signed-in start page (otherwise it is the floating chip). */
  headerShield?: boolean;
  /** What the app calls what it creates (`labels.noun`): the review's button reads "Create {noun}". */
  noun?: string;
  /** Fills the app's own inputs in the dialog's names step (beyond the two names). */
  fillFields?: (dialog: ReturnType<Page["locator"]>) => Promise<void>;
  /** Why `opened` is not the game itself. */
  standInNote?: string;
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
    settled: async (p) => {
      await expect(p.getByText("general", { exact: true }).first(), "#general was not made").toBeVisible({ timeout: 60_000 });
      await expect(p.getByAltText("Mero Chat Application Logo")).toBeVisible();
      await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    },
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
  {
    name: "battleships",
    noun: "lobby",
    headerShield: true,
    package: "com.calimero.mero-crm",
    standIn: "com.calimero.battleships",
    dist: dist("battleships"),
    signedIn: (p) => p.getByRole("button", { name: "Create a lobby" }),
    openCreate: (p) => p.getByRole("button", { name: "Create a lobby" }).click(),
    opened: (p, w) => p.getByTestId("lobby-row").filter({ hasText: w }),
  },
  {
    name: "mero-chess",
    noun: "table",
    headerShield: true,
    package: "com.calimero.mero-crm",
    standIn: "com.calimero.mero-chess",
    dist: dist("mero-chess"),
    signedIn: (p) => p.getByRole("button", { name: "New table" }),
    openCreate: (p) => p.getByRole("button", { name: "New table" }).click(),
    opened: (p) => p.getByText(/INIT_FAILED/),
    standInNote: "a stand-in package cannot run the game's init: the node's own refusal is shown, after the org was made",
  },
  {
    name: "mero-kombat",
    noun: "arena",
    headerShield: true,
    package: "com.calimero.mero-crm",
    standIn: "com.calimero.mero-kombat",
    dist: dist("mero-kombat"),
    signedIn: (p) => p.getByRole("button", { name: "New arena" }),
    openCreate: (p) => p.getByRole("button", { name: "New arena" }).click(),
    opened: (p) => p.getByText(/INIT_FAILED/),
    standInNote: "a stand-in package cannot run the game's init: the node's own refusal is shown, after the org was made",
  },
  {
    name: "mero-models",
    noun: "scene",
    fillFields: async (d) => {
      await d.getByLabel("Scene name").fill("E2E scene");
    },
    headerShield: true,
    package: "com.calimero.mero-crm",
    standIn: "com.calimero.mero-models",
    dist: dist("mero-models"),
    signedIn: (p) => p.getByTestId("new-scene"),
    openCreate: (p) => p.getByTestId("new-scene").click(),
    opened: (p) => p.getByText(/The scene is empty/),
  },
  {
    name: "mero-blocks",
    noun: "world",
    fillFields: async (d) => {
      await expect(d.getByLabel("Seed")).toHaveValue("1337");
      await d.getByLabel("Seed").fill("42");
    },
    package: "com.calimero.mero-crm",
    standIn: "com.calimero.mero-blocks",
    dist: dist("mero-blocks"),
    signUpTestId: "sign-up-btn",
    signedIn: (p) => p.getByTestId("create-world-open-btn"),
    openCreate: (p) => p.getByTestId("create-world-open-btn").click(),
    opened: (p) => p.getByTestId("join-error").filter({ hasText: /Could not create world.*INIT_FAILED/ }),
    standInNote: "a stand-in package cannot run the game's init: the node's own refusal is shown, after the org was made",
  },
  {
    name: "merraria",
    noun: "world",
    fillFields: async (d) => {
      await expect(d.getByLabel("Seed")).toHaveValue("1337");
      await d.getByLabel("Seed").fill("42");
    },
    package: "com.calimero.mero-crm",
    standIn: "com.calimero.merraria",
    dist: dist("merraria"),
    signUpTestId: "sign-up-btn",
    signedIn: (p) => p.getByTestId("create-world-open-btn"),
    openCreate: (p) => p.getByTestId("create-world-open-btn").click(),
    opened: (p) => p.getByTestId("join-error").filter({ hasText: /Could not create world/ }),
    standInNote: "a stand-in package has no createWorld: the node's own refusal is shown, after the org and the instance were made",
  },
];

/** An app no cluster serves yet: its build is served at Mero CRM's origin, with `VITE_CALIMERO_PACKAGE` set to CRM's package. */
const atCrm = (name: string, standIn: string, rest: Omit<App, "name" | "package" | "dist" | "standIn">): App => ({
  name,
  package: "com.calimero.mero-crm",
  standIn,
  dist: dist(name),
  ...rest,
});

const byText = (p: Page, w: string) => p.getByText(w).first();

const BATCH_A: App[] = [
  atCrm("mero-calendar", "com.calimero.mero-calendar", {
    signedIn: (p) => p.getByTestId("empty-teams"),
    openCreate: (p) => p.getByTestId("create-team-btn").click(),
    opened: byText,
  }),
  atCrm("mero-pixart", "com.calimero.mero-pixart", {
    signedIn: (p) => p.getByTestId("empty-teams"),
    openCreate: (p) => p.getByTestId("create-team-btn").click(),
    opened: byText,
  }),
  atCrm("mero-design", "com.calimero.mero-design", {
    signedIn: (p) => p.getByTestId("empty-teams"),
    openCreate: (p) => p.getByTestId("first-team-create").click(),
    opened: (p, w) => p.getByTestId("team-switcher").filter({ hasText: w }),
  }),
  atCrm("mero-forms", "com.calimero.mero-forms", {
    signedIn: (p) => p.getByRole("button", { name: "Start a new workspace" }),
    openCreate: (p) => p.getByRole("button", { name: "Start a new workspace" }).click(),
    // The instance runs CRM's contract here, so the workspace view's first call answers UnknownMethod: that is the view having opened.
    opened: (p) => p.getByText("UnknownMethod"),
    standInErrors: /UnknownMethod/,
  }),
  atCrm("mero-forum", "com.calimero.mero-forum", {
    signedIn: (p) => p.getByTestId("create-space"),
    openCreate: (p) => p.getByTestId("create-space").click(),
    opened: byText,
  }),
  atCrm("mero-pass", "com.calimero.mero-pass", {
    signedIn: (p) => p.getByTestId("teams-empty"),
    openCreate: (p) => p.getByTestId("team-create").click(),
    opened: byText,
  }),
  atCrm("mero-sheets", "com.calimero.mero-sheets", {
    signedIn: (p) => p.getByTestId("action-init_project"),
    openCreate: (p) => p.getByTestId("action-init_project").click(),
    opened: (p) => p.getByTitle(/^(Live|Offline)$/),
    standInErrors: /APP_ERROR|UnknownMethod/,
  }),
  atCrm("mero-sign", "com.calimero.mero-sign", {
    signedIn: (p) => p.getByTestId("create-workspace"),
    openCreate: (p) => p.getByTestId("create-workspace").click(),
    opened: (p) => p.getByRole("heading", { name: "Agreements" }),
  }),
  atCrm("mero-standup", "com.calimero.mero-standup", {
    signedIn: (p) => p.getByRole("button", { name: "Start a new team" }),
    openCreate: (p) => p.getByRole("button", { name: "Start a new team" }).click(),
    // The instance runs CRM's contract here, so naming the team answers UnknownMethod: the team exists by then.
    opened: (p) => p.getByText("UnknownMethod"),
    standInErrors: /UnknownMethod/,
  }),
  atCrm("mero-stream", "com.calimero.mero-stream", {
    signedIn: (p) => p.getByTestId("create-stream"),
    openCreate: (p) => p.getByTestId("create-stream").click(),
    opened: byText,
  }),
  atCrm("mero-updates", "com.calimero.mero-updates", {
    signedIn: (p) => p.getByTestId("create-space"),
    openCreate: (p) => p.getByTestId("create-space").click(),
    opened: byText,
  }),
  atCrm("mero-vote", "com.calimero.mero-vote", {
    signedIn: (p) => p.getByRole("button", { name: "Create voting group" }),
    openCreate: (p) => p.getByRole("button", { name: "Create voting group" }).click(),
    opened: byText,
  }),
  atCrm("hyperfeed", "com.calimero.hyperfeed", {
    signIn: (p) => p.getByRole("button", { name: "Open your feed" }).first(),
    signedIn: (p) => p.getByRole("button", { name: "Create my feed" }),
    openCreate: (p) => p.getByRole("button", { name: "Create my feed" }).click(),
    opened: (p, w) => p.getByTitle("Switch feed").filter({ hasText: w }),
  }),
  atCrm("kv-store", "com.calimero.kv-store", {
    signedIn: (p) => p.getByRole("button", { name: "Create", exact: true }),
    openCreate: (p) => p.getByRole("button", { name: "Create", exact: true }).click(),
    opened: byText,
  }),
];

/** What the page logged as an error, kept for the report. */
const consoleLines: string[] = [];

test.afterEach(async ({}, info) => {
  await info.attach("browser-log.txt", { body: consoleLines.join("\n") || "(nothing)", contentType: "text/plain" });
});

const only = process.env.E2E_APPS?.split(/[\s,]+/).filter(Boolean);

for (const app of [...APPS, ...BATCH_A].filter((a) => process.env.CREATE_WORKSPACE_E2E === "1" && (!only || only.includes(a.name)))) {
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
      const signUp = page.getByTestId(app.signUpTestId ?? "signup-passkey");
      const signIn = app.signIn?.(page) ?? page.getByRole("button", { name: "Sign in", exact: true }).first();
      await expect(signUp.or(signIn).first()).toBeVisible({ timeout: 60_000 });
      if (!(await signUp.isVisible())) await signIn.click();
      await expect(signUp).toBeVisible({ timeout: 60_000 });
      await shot("signed-out");
      await signUp.click();
      if (await page.getByTestId("signup-name").isVisible()) await signUp.click();
      const approve = page.locator('[data-testid="signup-approve"]:enabled');
      await expect(approve.or(app.signedIn(page)).first()).toBeVisible({ timeout: 120_000 });
      if (await approve.isVisible()) await approve.click();
      await expect(app.signedIn(page)).toBeVisible({ timeout: 120_000 });
      await shot("signed-in");
      // The header at phone width: nothing wraps off the page.
      const wide = page.viewportSize();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: join(shots, "mobile-header.png") });
      expect(await page.evaluate(() => document.documentElement.scrollWidth), "the page scrolls sideways at 390px").toBeLessThanOrEqual(390);
      if (wide) await page.setViewportSize(wide);
      if (app.headerShield) await expect(page.locator("header .cp-shield, nav .cp-shield"), "the shield is in the header").toHaveCount(1);
    });

    const workspace = `E2E ${app.name} ${Date.now().toString(36)}`;
    await test.step("names", async () => {
      await app.openCreate(page);
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.locator("input").nth(0).fill(workspace);
      await dialog.locator("input").nth(1).fill("Ada");
      await app.fillFields?.(dialog);
      await shot("names");
      await dialog.getByRole("button", { name: /Continue/ }).click();
    });

    await test.step("review", async () => {
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Where it runs")).toBeVisible({ timeout: 90_000 });
      await expect(dialog.getByText(app.standIn ?? app.package, { exact: false }).or(dialog.getByText(app.package)).first()).toBeVisible();
      await expect(dialog.getByText("What it can do")).toBeVisible();
      await expect(dialog.getByText(/Loading what this app can do/)).toHaveCount(0, { timeout: 60_000 });
      await expect(dialog.getByRole("button", { name: `Create ${app.noun ?? "workspace"}` })).toBeEnabled({ timeout: 90_000 });
      await shot("review");
    });

    let popup!: Page;
    await test.step("create, and approve on the node in the pop-up", async () => {
      const opened = context.waitForEvent("page");
      await page.getByRole("dialog").getByRole("button", { name: `Create ${app.noun ?? "workspace"}` }).click();
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
      await app.settled?.(page);
      await shot("workspace-open");
    });

    if (app.name !== "mero-chat") {
      await test.step("one shield", async () => {
        await expect(page.locator(".cp-shield"), "one shield").toHaveCount(1);
      });
    }

    if (app.name === "mero-chat") {
      await test.step("one shield, in the header", async () => {
        const header = page.getByRole("navigation", { name: "Main navigation" });
        await expect(header.getByRole("button", { name: /node/i }).first()).toBeVisible();
        await expect(page.locator(".cp-shield"), "one shield, in the header").toHaveCount(1);
        await expect(header.locator(".cp-shield")).toHaveCount(1);
        await page.screenshot({ path: join(shots, `${String(++n).padStart(2, "0")}-header-with-shield.png`), clip: { x: 0, y: 0, width: 1280, height: 70 } });
      });
    }

    await test.step("no page errors", () => {
      const errors = consoleLines.filter((l) => /pageerror/.test(l) && !app.standInErrors?.test(l));
      expect(errors, consoleLines.join("\n")).toEqual([]);
    });
  });
}
