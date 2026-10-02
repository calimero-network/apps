import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page } from "@playwright/test";
import type { Actor, AppDriver, Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

function stamp(): string {
  return Date.now().toString(36);
}

function slot(actor: Actor): number {
  return actor.name === "alice" ? 0 : 1;
}

function cell(page: Page, row: number, col: number): Locator {
  return page.locator(`[data-testid="item-cell"][data-row="${row}"][data-col="${col}"]`);
}

function shows(value: string): RegExp {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\D|$)`);
}

const current: Record<string, string> = {};

async function settleNickname(actor: Actor, timeout = 20_000): Promise<void> {
  const page = actor.page;
  const modal = page.getByTestId("nickname-modal");
  const shown = await modal
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
  if (!shown) return;
  await page.getByTestId("field-nickname").fill(`${actor.name}-${actor.run}`);
  await page.getByTestId("action-join").click();
  const gone = await modal
    .waitFor({ state: "detached", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!gone) {
    await page.getByTestId("action-skip-nickname").click();
    await modal.waitFor({ state: "detached", timeout: 5_000 });
  }
}

async function press(actor: Actor, target: Locator): Promise<void> {
  try {
    await target.click({ timeout: 5_000 });
  } catch {
    await settleNickname(actor, 3_000);
    await target.click({ timeout: 15_000 });
  }
}

async function waitForGrid(actor: Actor, timeout = 90_000): Promise<void> {
  await expect(cell(actor.page, 0, 0)).toBeVisible({ timeout });
}

function picker(page: Page): Locator {
  return page.getByTestId("action-init_project");
}

async function toPicker(actor: Actor): Promise<void> {
  const page = actor.page;
  if (!(await picker(page).isVisible())) {
    await press(actor, page.getByRole("button", { name: "Back to spreadsheets" }).first());
  }
  await expect(picker(page)).toBeVisible({ timeout: 30_000 });
}

async function inSpreadsheet(actor: Actor, name: string): Promise<boolean> {
  const page = actor.page;
  return (await cell(page, 0, 0).isVisible()) && (await page.getByText(name, { exact: true }).count()) > 0;
}

async function openFromPicker(actor: Actor, name: string): Promise<boolean> {
  const page = actor.page;
  if (await inSpreadsheet(actor, name)) return true;
  await toPicker(actor);
  const row = page.getByTestId("workspace-item").filter({ hasText: name }).first();
  if (!(await row.isVisible())) return false;
  await row.click();
  await waitForGrid(actor);
  await settleNickname(actor);
  return inSpreadsheet(actor, name);
}

async function recover(actor: Actor): Promise<void> {
  const page = actor.page;
  await expect(cell(page, 0, 0).or(picker(page)).first()).toBeVisible({ timeout: 60_000 });
  const name = current[actor.name];
  if (name && (await picker(page).isVisible())) {
    const row = page.getByTestId("workspace-item").filter({ hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.click();
  }
  await waitForGrid(actor);
  await settleNickname(actor, 5_000);
}

async function eventually(actor: Actor, check: () => Promise<boolean>, message: string): Promise<void> {
  let refreshed = Date.now();
  await expect
    .poll(
      async () => {
        if (await check().catch(() => false)) return true;
        if (Date.now() - refreshed > 25_000) {
          refreshed = Date.now();
          await actor.page.reload();
          await recover(actor).catch(() => undefined);
        }
        return false;
      },
      { message, timeout: SYNC, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);
}

async function firstSheet(actor: Actor): Promise<void> {
  const tab = actor.page.getByTestId("item-sheet").first();
  await press(actor, tab);
}

async function enterCell(actor: Actor, row: number, col: number, value: string): Promise<void> {
  const page = actor.page;
  await press(actor, cell(page, row, col));
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}

async function createSpreadsheet(actor: Actor, name: string): Promise<void> {
  const page = actor.page;
  await expect(page.getByTestId("field-name")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("field-name").fill(name);
  await expect(picker(page)).toBeEnabled({ timeout: 30_000 });
  await picker(page).click();
  await waitForGrid(actor);
  await settleNickname(actor);
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  current[actor.name] = name;
}

const values: Record<string, { row: number; value: string }> = {};
const formulas: Record<string, { row: number; expected: string }> = {};
const comments: Record<string, { row: number; col: number; text: string }> = {};
const sheets: Record<string, { name: string }> = {};
const files: Record<string, { row: number; col: number; name: string; body: string }> = {};

const editCell: Feature = {
  name: "edit a cell",
  async do(actor) {
    const row = slot(actor);
    const value = String(10 + Math.floor(Math.random() * 90));
    values[actor.name] = { row, value };
    await firstSheet(actor);
    await enterCell(actor, row, 0, value);
    await expect(cell(actor.page, row, 0)).toHaveText(shows(value), { timeout: 30_000 });
  },
  async seen(actor, by) {
    const v = values[by.name];
    if (!v) throw new Error(`${by.name} has not edited a cell yet`);
    await eventually(
      actor,
      async () => {
        await firstSheet(actor);
        return shows(v.value).test((await cell(actor.page, v.row, 0).innerText()).trim());
      },
      `${actor.name} sees ${by.name}'s A${v.row + 1} = ${v.value}`,
    );
  },
};

const formula: Feature = {
  name: "a formula referencing edited cells",
  async do(actor) {
    const a1 = values["alice"];
    const a2 = values["bob"];
    if (!a1 || !a2) throw new Error("both A1 and A2 must be set first");
    const sum = Number(a1.value) + Number(a2.value);
    const row = slot(actor);
    const text = actor.name === "alice" ? "=A1+A2" : "=(A1+A2)*2";
    const expected = String(actor.name === "alice" ? sum : sum * 2);
    formulas[actor.name] = { row, expected };
    await firstSheet(actor);
    await enterCell(actor, row, 1, text);
    await expect(cell(actor.page, row, 1)).toHaveText(shows(expected), { timeout: 30_000 });
  },
  async seen(actor, by) {
    const f = formulas[by.name];
    if (!f) throw new Error(`${by.name} has not written a formula yet`);
    await eventually(
      actor,
      async () => {
        await firstSheet(actor);
        return shows(f.expected).test((await cell(actor.page, f.row, 1).innerText()).trim());
      },
      `${actor.name} sees ${by.name}'s formula computed as ${f.expected}`,
    );
  },
};

async function openComments(actor: Actor, row: number, col: number): Promise<Locator> {
  const page = actor.page;
  const panel = page.getByRole("dialog", { name: "Comments" });
  if (await panel.isVisible()) await page.getByRole("button", { name: "Close comments" }).click();
  await firstSheet(actor);
  await press(actor, cell(page, row, col));
  await press(actor, page.getByTestId("action-comments"));
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return panel;
}

const comment: Feature = {
  name: "comment on a cell",
  async do(actor) {
    const page = actor.page;
    const row = slot(actor) + 4;
    const col = 2;
    const text = `comment ${actor.name} ${actor.run} ${stamp()}`;
    comments[actor.name] = { row, col, text };
    const panel = await openComments(actor, row, col);
    await panel.getByTestId("field-comment").fill(text);
    await panel.getByTestId("field-comment-submit").click();
    await expect(panel.getByTestId("item-Comment").filter({ hasText: text })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Close comments" }).click();
    await expect(panel).toHaveCount(0, { timeout: 5_000 });
  },
  async seen(actor, by) {
    const c = comments[by.name];
    if (!c) throw new Error(`${by.name} has not commented yet`);
    await eventually(
      actor,
      async () => {
        const panel = await openComments(actor, c.row, c.col);
        return (await panel.getByTestId("item-Comment").filter({ hasText: c.text }).count()) > 0;
      },
      `${actor.name} sees ${by.name}'s comment`,
    );
    await actor.page.getByRole("button", { name: "Close comments" }).click();
  },
};

async function openFiles(actor: Actor, row: number, col: number): Promise<Locator> {
  const page = actor.page;
  const close = page.getByRole("button", { name: "Close files" });
  if (await close.isVisible()) await close.click();
  await firstSheet(actor);
  await cell(page, row, col).click({ button: "right" });
  await press(actor, page.getByTestId("action-open-files"));
  const panel = page.getByRole("dialog", { name: /^Files on / });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return panel;
}

const attach: Feature = {
  name: "attach a file to a cell (blob)",
  async do(actor) {
    const page = actor.page;
    const row = slot(actor) + 8;
    const col = 3;
    const name = `att-${actor.name}-${actor.run}-${stamp()}.txt`;
    const body = `blob from ${actor.name} ${actor.run} ${stamp()}`;
    files[actor.name] = { row, col, name, body };
    const panel = await openFiles(actor, row, col);
    await panel.getByTestId("field-attach").setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(body, "utf8"),
    });
    await expect(panel.getByTestId("item-Attachment").filter({ hasText: name })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Close files" }).click();
  },
  async seen(actor, by) {
    const f = files[by.name];
    if (!f) throw new Error(`${by.name} has not attached a file yet`);
    const page = actor.page;
    await eventually(
      actor,
      async () => {
        const panel = await openFiles(actor, f.row, f.col);
        return (await panel.getByTestId("item-Attachment").filter({ hasText: f.name }).count()) > 0;
      },
      `${actor.name} sees ${by.name}'s attachment`,
    );
    await expect
      .poll(
        async () => {
          const item = page.getByTestId("item-Attachment").filter({ hasText: f.name }).first();
          const download = page.waitForEvent("download", { timeout: 20_000 });
          await item.getByTestId("action-download-file").click();
          const file = await download;
          const path = await file.path();
          return (await readFile(path, "utf8")) === f.body && file.suggestedFilename() === f.name;
        },
        { message: `${actor.name} downloads ${by.name}'s blob bytes`, timeout: SYNC, intervals: [2_000, 3_000, 5_000] },
      )
      .toBe(true);
    await page.getByRole("button", { name: "Close files" }).click();
  },
};

const addSheet: Feature = {
  name: "add a sheet",
  async do(actor) {
    const page = actor.page;
    const name = `s-${actor.name}-${stamp()}`;
    sheets[actor.name] = { name };
    const tabs = page.getByTestId("item-sheet");
    const before = await tabs.count();
    await press(actor, page.getByTestId("action-create_sheet"));
    await expect(tabs).toHaveCount(before + 1, { timeout: 30_000 });
    await tabs.last().dblclick();
    const input = page.getByLabel("Rename sheet");
    await input.fill(name);
    await input.press("Enter");
    await expect(tabs.filter({ hasText: name })).toBeVisible({ timeout: 30_000 });
    await firstSheet(actor);
  },
  async seen(actor, by) {
    const s = sheets[by.name];
    if (!s) throw new Error(`${by.name} has not added a sheet yet`);
    await eventually(
      actor,
      async () => (await actor.page.getByTestId("item-sheet").filter({ hasText: s.name }).count()) > 0,
      `${actor.name} sees ${by.name}'s sheet tab`,
    );
  },
};

export const driver: AppDriver = {
  app: "mero-sheets",

  async createNamespace(actor, name) {
    await createSpreadsheet(actor, name);
  },

  async createSpace(actor, name) {
    await toPicker(actor);
    await createSpreadsheet(actor, name);
  },

  async openSpace(actor, name) {
    await eventually(actor, () => openFromPicker(actor, name), `${actor.name} opens the spreadsheet ${name}`);
    current[actor.name] = name;
  },

  async invite(actor) {
    const page = actor.page;
    await press(actor, page.getByRole("button", { name: "Invite collaborators" }));
    const link = page.getByTestId("invite-link");
    await expect(link).toBeVisible({ timeout: 60_000 });
    const text = (await link.getAttribute("title")) || (await link.innerText());
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("invite-modal")).toHaveCount(0, { timeout: 5_000 });
    return text.trim();
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    await expect(picker(page)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Join with invitation" }).click();
    await page.getByTestId("field-invitation").fill(link);
    await page.getByTestId("action-join-workspace").click();
    await expect(page.getByTestId("join-modal")).toHaveCount(0, { timeout: 60_000 });
    await waitForGrid(actor);
    await settleNickname(actor);
  },

  async afterReload(actor) {
    await recover(actor);
  },

  features: [editCell, formula, comment, attach, addSheet],
};
