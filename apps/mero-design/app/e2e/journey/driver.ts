import { deflateSync } from "node:zlib";
import { expect, type Locator, type Page } from "@playwright/test";
import type { Actor, AppDriver, Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

const actors: Partial<Record<Actor["name"], Actor>> = {};
const blobsFetched: Partial<Record<Actor["name"], Set<string>>> = {};
const tracked = new WeakSet<Page>();
const boards: Record<string, string> = {};
const named = new Set<string>();
let teamId = "";
let teamName = "";
let mainBoard = "";
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

function boardPath(name: string): string {
  const ctx = boards[name];
  if (!ctx) throw new Error(`no board named ${name} yet`);
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

async function waitBoard(actor: Actor): Promise<void> {
  await expect(actor.page.getByTestId("fabric-canvas")).toBeVisible({ timeout: SYNC });
  const key = `${actor.name}:${new URL(actor.page.url()).pathname}`;
  await nameIfAsked(actor, named.has(key) ? 0 : 15_000);
  named.add(key);
}

async function ensureBoard(actor: Actor): Promise<void> {
  const path = boardPath(mainBoard);
  if (new URL(actor.page.url()).pathname !== path) {
    await actor.page.goto(path);
    await waitBoard(actor);
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
          await waitBoard(actor);
        }
        return false;
      },
      { timeout: SYNC, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);
}

async function showLayers(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Layers", exact: true }).click();
}

async function showProps(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Props", exact: true }).click();
}

function layerRow(page: Page, id: string): Locator {
  return page.getByTestId(`layer-item-${id}`);
}

async function layerIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="layer-item-"]')
    .evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") ?? "").slice("layer-item-".length)));
}

async function newLayerId(page: Page, before: string[]): Promise<string> {
  let id = "";
  await expect
    .poll(
      async () => {
        await showLayers(page);
        id = (await layerIds(page)).find((x) => !before.includes(x)) ?? "";
        return id;
      },
      { timeout: 30_000 },
    )
    .not.toBe("");
  return id;
}

async function selectLayer(page: Page, id: string): Promise<void> {
  await showLayers(page);
  await layerRow(page, id).click();
  await showProps(page);
}

async function grantEditor(alice: Actor): Promise<void> {
  const page = alice.page;
  await gotoTeam(alice);
  const card = projectCard(page, mainBoard);
  await expect(card).toBeVisible({ timeout: 30_000 });
  const ctx = await contextIdOf(card);
  await expect
    .poll(
      async () => {
        await card.locator("xpath=..").getByTitle("More options").click();
        await page.getByTestId(`project-settings-${ctx}`).click();
        const make = page.getByRole("button", { name: "Make editor" }).first();
        const found = await make.waitFor({ timeout: 10_000 }).then(
          () => true,
          () => false,
        );
        if (found) {
          await make.click();
          await expect(page.getByRole("button", { name: "Make viewer" }).first()).toBeVisible({ timeout: 30_000 });
        }
        await page.getByRole("button", { name: "✕", exact: true }).click();
        return found;
      },
      { timeout: SYNC, intervals: [2_000, 5_000] },
    )
    .toBe(true);
}

async function waitEditable(actor: Actor): Promise<void> {
  await eventually(actor, async () => actor.page.getByTestId("tool-rect").isEnabled());
}

const rects: Partial<Record<Actor["name"], string>> = {};
const drawn: Partial<Record<Actor["name"], number>> = {};

const drawRect: Feature = {
  name: "draw a rectangle",
  async do(actor) {
    const page = actor.page;
    await ensureBoard(actor);
    await showLayers(page);
    const before = await layerIds(page);
    const n = (drawn[actor.name] ?? 0) + 1;
    drawn[actor.name] = n;
    const x = 160 + ((n - 1) % 5) * 90;
    const y = actor.name === "alice" ? 140 : 300;
    await page.getByTestId("tool-rect").click();
    const box = await page.getByTestId("fabric-canvas").boundingBox();
    if (!box) throw new Error("the canvas has no bounding box");
    await page.mouse.move(box.x + x, box.y + y);
    await page.mouse.down();
    await page.mouse.move(box.x + x + 60, box.y + y + 50, { steps: 8 });
    await page.mouse.up();
    rects[actor.name] = await newLayerId(page, before);
  },
  async seen(actor, by) {
    const id = rects[by.name];
    if (!id) throw new Error(`${by.name} has not drawn anything yet`);
    await ensureBoard(actor);
    await eventually(actor, async () => {
      await showLayers(actor.page);
      return layerRow(actor.page, id).isVisible();
    });
  },
};

const images: Partial<Record<Actor["name"], { id: string; blobId: string }>> = {};

const placeImage: Feature = {
  name: "place an image (blob crosses nodes)",
  async do(actor) {
    const page = actor.page;
    await ensureBoard(actor);
    await showLayers(page);
    const before = await layerIds(page);
    const upload = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" && new URL(r.url()).pathname.endsWith("/admin-api/blobs") && r.ok(),
      { timeout: 30_000 },
    );
    await page.getByTestId("image-file-input").setInputFiles({
      name: `${actor.name}-${actor.run}.png`,
      mimeType: "image/png",
      buffer: solidPng(32),
    });
    const body = (await (await upload).json()) as { data?: { blob_id?: string; blobId?: string } };
    const blobId = body.data?.blob_id ?? body.data?.blobId ?? "";
    expect(blobId, "the node returned a blob id").not.toBe("");
    const id = await newLayerId(page, before);
    images[actor.name] = { id, blobId };
  },
  async seen(actor, by) {
    const img = images[by.name];
    if (!img) throw new Error(`${by.name} has not placed an image yet`);
    await ensureBoard(actor);
    await eventually(actor, async () => {
      await showLayers(actor.page);
      if (!(await layerRow(actor.page, img.id).isVisible())) return false;
      return blobsFetched[actor.name]?.has(img.blobId) ?? false;
    });
  },
};

const renamed: Partial<Record<Actor["name"], { id: string; name: string }>> = {};

const renameShape: Feature = {
  name: "rename the other person's rectangle",
  async do(actor) {
    const page = actor.page;
    const other = actor.name === "alice" ? "bob" : "alice";
    const id = rects[other] ?? rects[actor.name];
    if (!id) throw new Error("no rectangle to rename");
    const name = `r-${actor.name}-${Date.now().toString(36)}`;
    renamed[actor.name] = { id, name };
    await ensureBoard(actor);
    await selectLayer(page, id);
    const field = page.getByTestId("element-name");
    await expect(field).toBeEnabled({ timeout: 30_000 });
    await field.fill(name);
    await field.press("Tab");
    await showLayers(page);
    await expect(layerRow(page, id)).toContainText(name, { timeout: 30_000 });
  },
  async seen(actor, by) {
    const r = renamed[by.name];
    if (!r) throw new Error(`${by.name} has not renamed anything yet`);
    await ensureBoard(actor);
    await eventually(actor, async () => {
      await showLayers(actor.page);
      return (await layerRow(actor.page, r.id).innerText()).includes(r.name);
    });
  },
};

const deleteImage: Feature = {
  name: "delete an image",
  oneWay: true,
  async do(actor) {
    const page = actor.page;
    const img = images[actor.name];
    if (!img) throw new Error("no image to delete");
    await ensureBoard(actor);
    await selectLayer(page, img.id);
    await page.getByTestId("delete-element").click();
    await showLayers(page);
    await expect(layerRow(page, img.id)).toHaveCount(0, { timeout: 30_000 });
  },
  async seen(actor, by) {
    const img = images[by.name];
    if (!img) throw new Error(`${by.name} has not deleted anything`);
    await ensureBoard(actor);
    await eventually(actor, async () => {
      await showLayers(actor.page);
      return (await layerRow(actor.page, img.id).count()) === 0;
    });
  },
};

export const driver: AppDriver = {
  app: "mero-design",

  async createNamespace(actor, name) {
    track(actor);
    const page = actor.page;
    teamName = name;
    await expect(page.getByRole("heading", { name: "Your Teams" })).toBeVisible({ timeout: 60_000 });
    await page.getByPlaceholder("New team name").fill(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const card = page.locator("button", { hasText: name });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();
    await page.waitForURL(/\/teams\/[^/]+\/projects$/, { timeout: 30_000 });
    teamId = new URL(page.url()).pathname.split("/")[2] ?? "";
    await expect(projectsTab(page)).toBeVisible({ timeout: 30_000 });
  },

  async createSpace(actor, name) {
    track(actor);
    const page = actor.page;
    await gotoTeam(actor);
    await page.getByTestId("new-project-input").fill(name);
    await page.getByTestId("create-project-btn").click();
    const card = projectCard(page, name);
    await expect(card).toBeVisible({ timeout: 60_000 });
    boards[name] = await contextIdOf(card);
    if (!mainBoard) mainBoard = name;
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
    boards[name] = await contextIdOf(card);
    await card.click();
    await waitBoard(actor);
    const alice = actors.alice;
    if (name === mainBoard && !granted && alice && alice !== actor) {
      await grantEditor(alice);
      granted = true;
      await waitEditable(actor);
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
    await expect(page.getByRole("heading", { name: "Your Teams" })).toBeVisible({ timeout: 60_000 });
    await page.getByPlaceholder("Paste invitation code").fill(link);
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page.getByTestId("toast").filter({ hasText: /Joined team|already in this team/ })).toBeVisible({
      timeout: SYNC,
    });
    const card = page.locator("button", { hasText: teamName });
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.click();
    await page.waitForURL(/\/teams\/[^/]+\/projects$/, { timeout: 30_000 });
    await expect(projectsTab(page)).toBeVisible({ timeout: 30_000 });
  },

  async afterReload(actor) {
    await waitBoard(actor);
  },

  features: [drawRect, placeImage, renameShape, deleteImage],
};
