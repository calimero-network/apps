import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page } from "@playwright/test";
import { completeNodeLogin, type Actor, type AppDriver, type Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

const kvWritten: Record<string, { key: string; value: string }> = {};
const counted: Record<string, number> = {};
const uploaded: Record<string, { name: string; body: string }> = {};
/** The context the last invitation names, read off the link it was shared as. */
let invitedContextId = "";

/** The `contextId` inside an invitation link's token (base64url JSON). */
function contextIdOf(link: string): string {
  const token = new URL(link).searchParams.get("invitation") ?? "";
  const json = Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const contextId = (JSON.parse(json) as { contextId?: unknown }).contextId;
  if (typeof contextId !== "string" || !contextId) throw new Error("the invitation link names no context");
  return contextId;
}

function card(page: Page, name: string): Locator {
  return page.locator(".method-card").filter({ hasText: name });
}

async function waitForApp(page: Page): Promise<void> {
  await expect(page.locator("aside").getByRole("button", { name: /Logout$/ })).toBeVisible({ timeout: 60_000 });
}

async function openSection(page: Page, label: string, heading: string): Promise<void> {
  await waitForApp(page);
  await page.locator("aside").getByRole("button", { name: new RegExp(`${label}$`) }).click();
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({ timeout: 15_000 });
}

async function waitForContext(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /^ctx:/ })).toBeVisible({ timeout: SYNC });
}

async function counterValue(page: Page): Promise<number> {
  const text = (await page.getByTestId("live-g-counter").innerText()).trim();
  const n = Number(text);
  return Number.isFinite(n) ? n : -1;
}

async function openCounter(actor: Actor): Promise<void> {
  const page = actor.page;
  await openSection(page, "Counters", "CRDT Counters");
  await page.getByPlaceholder("counter key (e.g. hits)").fill(`g-${actor.run}`);
}

const kvSet: Feature = {
  name: "set a KV entry",
  async do(actor: Actor) {
    const page = actor.page;
    const key = `${actor.name}-${actor.run}`;
    const value = `v-${Date.now().toString(36)}`;
    kvWritten[actor.name] = { key, value };
    await openSection(page, "KV Operations", "KV Operations");
    const set = card(page, "set(key, value)");
    await set.getByPlaceholder("key", { exact: true }).fill(key);
    await set.getByPlaceholder("value", { exact: true }).fill(value);
    await set.getByRole("button", { name: "Execute", exact: true }).click();
    await expect(card(page, "entries() — live view")).toContainText(`"${key}": "${value}"`, { timeout: 30_000 });
  },
  async seen(actor: Actor, by: Actor) {
    const w = kvWritten[by.name];
    if (!w) throw new Error(`${by.name} has not written anything yet`);
    const page = actor.page;
    if (!(await page.getByRole("heading", { name: "KV Operations", exact: true }).isVisible().catch(() => false))) {
      await openSection(page, "KV Operations", "KV Operations");
    }
    await expect(card(page, "entries() — live view")).toContainText(`"${w.key}": "${w.value}"`, { timeout: SYNC });
  },
};

const gCounter: Feature = {
  name: "increment a G-counter",
  async do(actor: Actor) {
    const page = actor.page;
    await openCounter(actor);
    await expect
      .poll(() => counterValue(page), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(0)
      .catch(() => undefined);
    const before = Math.max(0, await counterValue(page));
    await card(page, "G-Counter — increment_g_counter").getByRole("button", { name: "increment", exact: true }).click();
    await expect.poll(() => counterValue(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(before + 1);
    counted[actor.name] = await counterValue(page);
  },
  async seen(actor: Actor, by: Actor) {
    const want = counted[by.name];
    if (want === undefined) throw new Error(`${by.name} has not incremented yet`);
    await openCounter(actor);
    await expect
      .poll(() => counterValue(actor.page), { timeout: SYNC, intervals: [1_000, 2_000, 3_000] })
      .toBeGreaterThanOrEqual(want);
  },
};

const blob: Feature = {
  name: "upload a file and download it on the other node",
  async do(actor: Actor) {
    const page = actor.page;
    const name = `${actor.name}-${actor.run}.txt`;
    const body = `blob from ${actor.name} at ${Date.now().toString(36)}\n`.repeat(64);
    uploaded[actor.name] = { name, body };
    await openSection(page, "Blob Storage", "Blob Storage");
    const upload = card(page, "upload_file");
    await upload.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(body) });
    await upload.getByRole("button", { name: "Upload & Register", exact: true }).click();
    await expect(upload.getByText(/Registered — file_id/)).toBeVisible({ timeout: 30_000 });
    await expect(card(page, "Shared files — live view").locator("tr", { hasText: name })).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor: Actor, by: Actor) {
    const u = uploaded[by.name];
    if (!u) throw new Error(`${by.name} has not uploaded anything yet`);
    const page = actor.page;
    await openSection(page, "Blob Storage", "Blob Storage");
    const row = card(page, "Shared files — live view").locator("tr", { hasText: u.name });
    await expect(row).toBeVisible({ timeout: SYNC });
    const deadline = Date.now() + SYNC;
    for (;;) {
      const downloaded = page.waitForEvent("download", { timeout: 45_000 }).catch(() => null);
      await row.getByRole("button", { name: "Download", exact: true }).click();
      const download = await downloaded;
      if (download) {
        const path = await download.path();
        expect(await readFile(path, "utf8")).toBe(u.body);
        return;
      }
      if (Date.now() > deadline) {
        const failure = await card(page, "Shared files — live view").innerText().catch(() => "");
        throw new Error(`the file never downloaded on ${actor.name}'s node:\n${failure.slice(0, 1_000)}`);
      }
      await page.waitForTimeout(3_000);
    }
  },
};

export const driver: AppDriver = {
  app: "scaffolding-e2e",
  // No "you're invited" screen: a test harness that drives node discovery itself, with no ConnectButton.
  inviteLanding: false,

  async login(actor) {
    const page = actor.page;
    const connect = page.getByRole("button", { name: "Connect & Login", exact: true });
    await expect(connect).toBeVisible({ timeout: 30_000 });
    await page.getByRole("textbox").fill(actor.node.url);
    await connect.click();
    await completeNodeLogin(page, actor.node.url);
    await waitForApp(page);
  },

  async createNamespace(actor) {
    const page = actor.page;
    invitedContextId = "";
    await openSection(page, "Setup Wizard", "Setup Wizard");
    await page.getByRole("button", { name: /I'm the Owner/ }).click();
    const run = page.getByRole("button", { name: "Set it all up", exact: true });
    await expect(run).toBeEnabled({ timeout: 30_000 });
    await run.click();
    await expect(page.getByText(/Ready\. namespace/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByPlaceholder("Namespace ID (hex)", { exact: true })).not.toHaveValue("", { timeout: 15_000 });
  },

  async invite(actor) {
    const page = actor.page;
    await page.getByRole("button", { name: "Generate Invitation", exact: true }).click();
    const shown = page.getByTestId("invite-link");
    await expect(shown).toBeVisible({ timeout: 30_000 });
    // Read before copying: copying completes the step, which folds it away.
    const link = (await shown.innerText()).trim();
    await page.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(page.getByRole("button", { name: /✓ Generate Namespace Invitation/ })).toBeVisible({ timeout: 10_000 });
    invitedContextId = contextIdOf(link);
    return link;
  },

  async joined(actor) {
    const page = actor.page;
    if (!invitedContextId) throw new Error("no invitation has been created");
    // The dialog joins the namespace, then the context, and makes it active:
    // the context bar shows it without a reload.
    const active = page.getByRole("button", { name: new RegExp(`^ctx: ${invitedContextId.slice(0, 16)}`) });
    const failed = page.locator('[data-testid="invite-prompt"][data-stage="failed"]');
    const landed = active.waitFor({ state: "visible", timeout: SYNC * 2 });
    const refused = failed
      .first()
      .waitFor({ state: "visible", timeout: SYNC * 2 })
      .then(async () => {
        throw new Error(`join refused: ${await failed.first().innerText()}`);
      });
    landed.catch(() => undefined);
    refused.catch(() => undefined);
    await Promise.race([landed, refused]);
  },

  async afterReload(actor) {
    await waitForApp(actor.page);
    await waitForContext(actor.page);
  },

  features: [kvSet, gCounter, blob],
};
