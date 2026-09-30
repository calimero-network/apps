import { deflateSync } from "node:zlib";
import { expect, type Locator, type Page } from "@playwright/test";
import type { Actor, AppDriver, Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

const actors: Partial<Record<Actor["name"], Actor>> = {};
const blobsFetched: Partial<Record<Actor["name"], Set<string>>> = {};
const tracked = new WeakSet<Page>();
const projects: Record<string, string> = {};
const layerNames: Record<string, string> = {};
const named = new Set<string>();
let teamId = "";
let teamName = "";
let mainProject = "";
let granted = false;

function track(actor: Actor): void {
  actors[actor.name] = actor;
  if (tracked.has(actor.page)) return;
  tracked.add(actor.page);
  const fetched = new Set<string>();
  blobsFetched[actor.name] = fetched;
  actor.page.on("response", (res) => {
    if (res.request().method() !== "GET" || !res.ok()) return;
    const id = new URL(res.url()).pathname.match(/\/admin-api\/blobs\/([^/]+)$/)?.[1];
    if (id) fetched.add(id);
  });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function solidPng(size: number): Buffer {
  const rgb = [0, 1, 2].map(() => Math.floor(Math.random() * 256));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = rgb[0] ?? 0;
    row[2 + x * 3] = rgb[1] ?? 0;
    row[3 + x * 3] = rgb[2] ?? 0;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function projectsTab(page: Page): Locator {
  return page.getByRole("button", { name: "Projects", exact: true });
}

function projectCard(page: Page, name: string): Locator {
  return page.locator('[data-testid^="project-card-"]', { hasText: name });
}

function teamPath(): string {
  return `/teams/${teamId}/projects`;
}

function projectPath(name: string): string {
  const ctx = projects[name];
  if (!ctx) throw new Error(`no project named ${name} yet`);
  return `${teamPath()}/${ctx}`;
}

async function contextIdOf(card: Locator): Promise<string> {
  const testId = (await card.first().getAttribute("data-testid")) ?? "";
  return testId.slice("project-card-".length);
}

async function gotoTeam(actor: Actor): Promise<void> {
  const page = actor.page;
  if (new URL(page.url()).pathname !== teamPath()) await page.goto(teamPath());
  await expect(projectsTab(page)).toBeVisible({ timeout: 30_000 });
  await projectsTab(page).click();
}

async function openTeam(page: Page, name: string): Promise<void> {
  const card = page.locator('[data-testid^="team-card-"]', { hasText: name });
  await expect(card).toBeVisible({ timeout: 60_000 });
  teamId = ((await card.first().getAttribute("data-testid")) ?? "").slice("team-card-".length);
  await card.first().click();
  await page.waitForURL(/\/teams\/[^/]+\/projects$/, { timeout: 30_000 });
  await expect(projectsTab(page)).toBeVisible({ timeout: 30_000 });
}

async function nameIfAsked(actor: Actor, waitMs: number): Promise<void> {
  const page = actor.page;
  const input = page.getByTestId("username-input");
  const deadline = Date.now() + waitMs;
  do {
    if (await input.isVisible().catch(() => false)) {
      await input.fill(`${actor.name}-${actor.run}`);
      await page.getByTestId("username-submit").click();
      await expect(input).toBeHidden({ timeout: 30_000 });
      return;
    }
    if (Date.now() < deadline) await page.waitForTimeout(500);
  } while (Date.now() < deadline);
}

async function waitEditor(actor: Actor): Promise<void> {
  const page = actor.page;
  await expect
    .poll(
      async () => {
        if (await page.getByText("Could not load the project").isVisible().catch(() => false)) {
          await page.reload();
          return false;
        }
        if (await page.getByText("Loading project…").isVisible().catch(() => false)) return false;
        return page.getByTestId("layers-list").isVisible();
      },
      { timeout: SYNC, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);
  const key = `${actor.name}:${new URL(page.url()).pathname}`;
  await nameIfAsked(actor, named.has(key) ? 0 : 5_000);
  named.add(key);
}

async function ensureEditor(actor: Actor): Promise<void> {
  const path = projectPath(mainProject);
  if (new URL(actor.page.url()).pathname !== path) {
    await actor.page.goto(path);
    await waitEditor(actor);
  }
  await nameIfAsked(actor, 0);
}

async function eventually(actor: Actor, check: () => Promise<boolean>): Promise<void> {
  let lastReload = Date.now();
  await expect
    .poll(
      async () => {
        await nameIfAsked(actor, 0);
        if (await check().catch(() => false)) return true;
        if (Date.now() - lastReload > 30_000) {
          lastReload = Date.now();
          await actor.page.reload();
          await waitEditor(actor);
        }
        return false;
      },
      { timeout: SYNC, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);
}

function layerRow(page: Page, id: string): Locator {
  return page.getByTestId(`layer-row-${id}`);
}

async function layerIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="layer-row-"]')
    .evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") ?? "").slice("layer-row-".length)));
}

async function newLayerId(page: Page, before: string[]): Promise<string> {
  let id = "";
  await expect
    .poll(
      async () => {
        id = (await layerIds(page)).find((x) => !before.includes(x)) ?? "";
        return id;
      },
      { timeout: 30_000 },
    )
    .not.toBe("");
  return id;
}

function addRasterButton(page: Page): Locator {
  return page.getByRole("button", { name: "New raster layer", exact: true });
}

async function grantEditor(alice: Actor): Promise<void> {
  const page = alice.page;
  await gotoTeam(alice);
  const card = projectCard(page, mainProject);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () => {
        await card.locator("xpath=..").getByTitle("More options").click();
        await card.locator("xpath=..").getByRole("button", { name: "Settings", exact: true }).click();
        const make = page.getByRole("button", { name: "Make editor" }).first();
        const found = await make.waitFor({ timeout: 10_000 }).then(
          () => true,
          () => false,
        );
        if (found) {
          await make.click();
          await expect(page.getByRole("button", { name: "Make viewer" }).first()).toBeVisible({ timeout: 30_000 });
        }
        await page.getByRole("button", { name: "Close", exact: true }).click();
        return found;
      },
      { timeout: SYNC, intervals: [2_000, 5_000] },
    )
    .toBe(true);
}

const added: Partial<Record<Actor["name"], string>> = {};

const addLayer: Feature = {
  name: "add a raster layer",
  async do(actor) {
    const page = actor.page;
    await ensureEditor(actor);
    const before = await layerIds(page);
    await addRasterButton(page).click();
    const id = await newLayerId(page, before);
    layerNames[id] = "Layer";
    added[actor.name] = id;
  },
  async seen(actor, by) {
    const id = added[by.name];
    if (!id) throw new Error(`${by.name} has not added a layer yet`);
    await ensureEditor(actor);
    await eventually(actor, async () => layerRow(actor.page, id).isVisible());
  },
};

const images: Partial<Record<Actor["name"], { id: string; blobId: string; name: string }>> = {};

const placeImage: Feature = {
  name: "place an image (blob crosses nodes)",
  async do(actor) {
    const page = actor.page;
    await ensureEditor(actor);
    const before = await layerIds(page);
    const name = `img-${actor.name}-${Date.now().toString(36)}`;
    const upload = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" && new URL(r.url()).pathname.endsWith("/admin-api/blobs") && r.ok(),
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: "File", exact: true }).click();
    const chooser = page.waitForEvent("filechooser", { timeout: 15_000 });
    await page.getByRole("button", { name: "Place Image…" }).click();
    await (await chooser).setFiles({ name: `${name}.png`, mimeType: "image/png", buffer: solidPng(32) });
    const id = await newLayerId(page, before);
    const body = (await (await upload).json()) as { data?: { blob_id?: string; blobId?: string } };
    const blobId = body.data?.blob_id ?? body.data?.blobId ?? "";
    expect(blobId, "the node returned a blob id").not.toBe("");
    await expect(layerRow(page, id)).toContainText(name, { timeout: 30_000 });
    layerNames[id] = name;
    images[actor.name] = { id, blobId, name };
  },
  async seen(actor, by) {
    const img = images[by.name];
    if (!img) throw new Error(`${by.name} has not placed an image yet`);
    await ensureEditor(actor);
    await eventually(actor, async () => {
      if (!(await layerRow(actor.page, img.id).innerText()).includes(img.name)) return false;
      return blobsFetched[actor.name]?.has(img.blobId) ?? false;
    });
  },
};

const renamed: Partial<Record<Actor["name"], { id: string; name: string }>> = {};

const renameLayer: Feature = {
  name: "rename the other person's layer",
  async do(actor) {
    const page = actor.page;
    const other = actor.name === "alice" ? "bob" : "alice";
    const id = added[other] ?? added[actor.name];
    if (!id) throw new Error("no layer to rename");
    const current = layerNames[id] ?? "Layer";
    const name = `l-${actor.name}-${Date.now().toString(36)}`;
    renamed[actor.name] = { id, name };
    await ensureEditor(actor);
    await layerRow(page, id).getByText(current, { exact: true }).dblclick();
    const input = page.getByTestId(`layer-rename-${id}`);
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill(name);
    await input.press("Enter");
    await expect(layerRow(page, id)).toContainText(name, { timeout: 30_000 });
    layerNames[id] = name;
  },
  async seen(actor, by) {
    const r = renamed[by.name];
    if (!r) throw new Error(`${by.name} has not renamed anything yet`);
    await ensureEditor(actor);
    await eventually(actor, async () => (await layerRow(actor.page, r.id).innerText()).includes(r.name));
  },
};

const deleteImage: Feature = {
  name: "delete an image layer",
  oneWay: true,
  async do(actor) {
    const page = actor.page;
    const img = images[actor.name];
    if (!img) throw new Error("no image to delete");
    await ensureEditor(actor);
    await layerRow(page, img.id).click();
    await layerRow(page, img.id).getByRole("button", { name: "Delete layer", exact: true }).click();
    await expect(layerRow(page, img.id)).toHaveCount(0, { timeout: 30_000 });
  },
  async seen(actor, by) {
    const img = images[by.name];
    if (!img) throw new Error(`${by.name} has not deleted anything`);
    await ensureEditor(actor);
    await eventually(actor, async () => (await layerRow(actor.page, img.id).count()) === 0);
  },
};

export const driver: AppDriver = {
  app: "mero-pixart",

  async createNamespace(actor, name) {
    track(actor);
    const page = actor.page;
    teamName = name;
    await expect(page.getByTestId("new-team-input")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("new-team-input").fill(name);
    await page.getByTestId("create-team-btn").click();
    await openTeam(page, name);
  },

  async createSpace(actor, name) {
    track(actor);
    const page = actor.page;
    await gotoTeam(actor);
    await page.getByTestId("open-create-modal").click();
    await expect(page.getByTestId("create-modal")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("new-project-input").fill(name);
    await page.getByTestId("create-project-btn").click();
    await expect(page.getByTestId("create-modal")).toBeHidden({ timeout: 60_000 });
    const card = projectCard(page, name);
    await expect(card).toBeVisible({ timeout: 30_000 });
    projects[name] = await contextIdOf(card);
    if (!mainProject) mainProject = name;
  },

  async openSpace(actor, name) {
    track(actor);
    const page = actor.page;
    await gotoTeam(actor);
    const card = projectCard(page, name);
    await expect
      .poll(
        async () => {
          if (await card.isVisible()) return true;
          await page.reload();
          await card.waitFor({ timeout: 8_000 }).catch(() => undefined);
          return card.isVisible();
        },
        { timeout: SYNC, intervals: [2_000, 3_000, 5_000] },
      )
      .toBe(true);
    projects[name] = await contextIdOf(card);
    await card.click();
    await page.waitForURL((u) => u.pathname === projectPath(name), { timeout: 60_000 });
    await waitEditor(actor);
    const alice = actors.alice;
    if (name === mainProject && !granted && alice && alice !== actor) {
      await grantEditor(alice);
      granted = true;
      await eventually(actor, async () => addRasterButton(page).isVisible());
    }
  },

  async invite(actor) {
    const page = actor.page;
    await gotoTeam(actor);
    await page.getByRole("button", { name: "Invitations", exact: true }).click();
    await page.getByTestId("generate-invite").click();
    const token = page.getByTestId("invite-token");
    await expect(token).toBeVisible({ timeout: 30_000 });
    return (await token.getAttribute("title")) ?? (await token.innerText());
  },

  async acceptInvite(actor, link) {
    track(actor);
    const page = actor.page;
    await expect(page.getByTestId("join-code-input")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("join-code-input").fill(link);
    await page.getByTestId("join-team-btn").click();
    await expect(page.getByTestId("toast").filter({ hasText: /Joined team|already in this team/ })).toBeVisible({
      timeout: SYNC,
    });
    await openTeam(page, teamName);
  },

  async afterReload(actor) {
    await waitEditor(actor);
  },

  features: [addLayer, placeImage, renameLayer, deleteImage],
};
