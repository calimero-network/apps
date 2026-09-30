import { expect, type Locator, type Page } from "@playwright/test";
import type { Actor, AppDriver, Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

function other(actor: Actor): Actor["name"] {
  return actor.name === "alice" ? "bob" : "alice";
}

function stamp(): string {
  return Date.now().toString(36);
}

function sections(page: Page): Locator {
  return page.getByRole("navigation", { name: "Sections" });
}

async function readyAudience(page: Page): Promise<void> {
  await expect(sections(page).getByRole("link", { name: /^Updates/ })).toBeVisible({ timeout: 60_000 });
}

async function readyAudienceList(page: Page): Promise<void> {
  await expect(page.getByTestId("audience-scope-note")).toBeVisible({ timeout: 60_000 });
}

async function eventually(page: Page, target: () => Locator, ready: () => Promise<void>): Promise<void> {
  await expect
    .poll(
      async () => {
        if ((await target().count()) > 0) return true;
        await page.waitForTimeout(1_500);
        if ((await target().count()) > 0) return true;
        await page.reload();
        await ready();
        return (await target().count()) > 0;
      },
      { timeout: SYNC, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);
}

async function toSection(page: Page, name: RegExp, ready: () => Promise<void>): Promise<void> {
  await readyAudience(page);
  await sections(page).getByRole("link", { name }).click();
  await ready();
}

async function readyQuestions(page: Page): Promise<void> {
  await expect(page.getByTestId("question-box")).toBeVisible({ timeout: 30_000 });
}

async function readyUpdates(page: Page): Promise<void> {
  await readyAudience(page);
  await expect(page).toHaveURL(/\/a$/, { timeout: 30_000 });
}

async function toAudienceList(page: Page): Promise<void> {
  const back = page.getByRole("button", { name: "Audiences", exact: true });
  if (await back.isVisible().catch(() => false)) await back.click();
  await readyAudienceList(page);
}

async function enterAudience(page: Page, name: string): Promise<void> {
  const row = () => page.getByTestId("audience-row").filter({ hasText: name }).and(page.locator(":enabled"));
  await eventually(page, row, () => readyAudienceList(page));
  await row().first().click();
  await expect(page).toHaveURL(/\/a$/, { timeout: SYNC });
  await readyAudience(page);
}

function questionRow(page: Page, title: string): Locator {
  return page.getByTestId("question-row").filter({ hasText: title });
}

function updateRow(page: Page, title: string): Locator {
  return page.getByTestId("update-row").filter({ hasText: title });
}

function commentRow(page: Page, body: string): Locator {
  return page.getByTestId("comment").filter({ hasText: body });
}

async function readyPost(page: Page, title: string): Promise<void> {
  await expect(page.getByTestId("post").getByRole("heading", { level: 1 })).toHaveText(title, { timeout: 30_000 });
}

async function openUpdate(page: Page, title: string): Promise<void> {
  await toSection(page, /^Updates/, () => readyUpdates(page));
  await eventually(page, () => updateRow(page, title), () => readyUpdates(page));
  await updateRow(page, title).first().click();
  await readyPost(page, title);
}

const questions: Record<string, string> = {};
const updates: Record<string, string> = {};
const answered: Record<string, string> = {};
const replies: Record<string, { update: string; body: string }> = {};

const askQuestion: Feature = {
  name: "open a Q&A thread",
  async do(actor) {
    const page = actor.page;
    const title = `${actor.name} asks ${actor.run} ${stamp()}`;
    questions[actor.name] = title;
    await toSection(page, /^Q&A/, () => readyQuestions(page));
    const box = page.getByTestId("question-box");
    await box.getByLabel("Question", { exact: true }).fill(title);
    await box.getByRole("button", { name: "Post", exact: true }).click();
    await readyPost(page, title);
  },
  async seen(actor, by) {
    const title = questions[by.name];
    if (!title) throw new Error(`${by.name} has not asked anything yet`);
    const page = actor.page;
    await toSection(page, /^Q&A/, () => readyQuestions(page));
    await eventually(page, () => questionRow(page, title), () => readyQuestions(page));
  },
};

const publishUpdate: Feature = {
  name: "publish an investor update",
  oneWay: true,
  async do(actor) {
    const page = actor.page;
    const title = `${actor.name} update ${actor.run} ${stamp()}`;
    updates[actor.name] = title;
    await toSection(page, /^Updates/, () => readyUpdates(page));
    await page.getByRole("button", { name: /Monthly update/ }).first().click();
    const composer = page.getByTestId("composer");
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.getByLabel("Title", { exact: true }).fill(title);
    await composer.getByLabel("Summary", { exact: true }).fill(`summary of ${title}`);
    await expect(page.getByTestId("publish")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("publish").click();
    await readyPost(page, title);
  },
  async seen(actor, by) {
    const title = updates[by.name];
    if (!title) throw new Error(`${by.name} has not published anything yet`);
    const page = actor.page;
    await toSection(page, /^Updates/, () => readyUpdates(page));
    await eventually(page, () => updateRow(page, title), () => readyUpdates(page));
  },
};

const replyToUpdate: Feature = {
  name: "reply to an update",
  async do(actor) {
    const update = updates[actor.name] ?? updates[other(actor)];
    if (!update) throw new Error("no update to reply to");
    const body = `${actor.name} replies ${actor.run} ${stamp()}`;
    replies[actor.name] = { update, body };
    const page = actor.page;
    await openUpdate(page, update);
    const box = page.getByTestId("reply-box");
    await box.locator("textarea").fill(body);
    await box.getByRole("button", { name: "Send", exact: true }).click();
    await expect(commentRow(page, body)).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor, by) {
    const r = replies[by.name];
    if (!r) throw new Error(`${by.name} has not replied yet`);
    const page = actor.page;
    await openUpdate(page, r.update);
    await eventually(page, () => commentRow(page, r.body), () => readyPost(page, r.update));
  },
};

const answerQuestion: Feature = {
  name: "the team marks an investor's question answered",
  oneWay: true,
  async do(actor) {
    const title = questions[other(actor)];
    if (!title) throw new Error("no question to answer");
    const page = actor.page;
    await toSection(page, /^Q&A/, () => readyQuestions(page));
    await eventually(page, () => questionRow(page, title), () => readyQuestions(page));
    await questionRow(page, title).first().click();
    await readyPost(page, title);
    await page.getByRole("button", { name: "Mark answered", exact: true }).click();
    await expect(page.getByTestId("post").getByText("Answered", { exact: true })).toBeVisible({ timeout: 30_000 });
    answered[actor.name] = title;
  },
  async seen(actor, by) {
    const title = answered[by.name];
    if (!title) throw new Error(`${by.name} has not answered anything yet`);
    const page = actor.page;
    await toSection(page, /^Q&A/, () => readyQuestions(page));
    await eventually(
      page,
      () => questionRow(page, title).filter({ has: page.getByText("Answered", { exact: true }) }),
      () => readyQuestions(page),
    );
  },
};

const currentAudience: Record<string, string> = {};

export const driver: AppDriver = {
  app: "mero-updates",

  async createNamespace(actor, name) {
    const page = actor.page;
    await expect(page.getByTestId("space-name-input")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("space-name-input").fill(name);
    await expect(page.getByTestId("create-space")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("create-space").click();
    await expect(page).toHaveURL(/\/companies\/[^/]+$/, { timeout: 60_000 });
    await readyAudienceList(page);
  },

  async createSpace(actor, name) {
    const page = actor.page;
    await toAudienceList(page);
    await page.getByTestId("audience-name-input").fill(name);
    await expect(page.getByTestId("create-audience")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("create-audience").click();
    await expect(page).toHaveURL(/\/a$/, { timeout: 60_000 });
    await readyAudience(page);
    currentAudience[actor.name] = name;
  },

  async openSpace(actor, name) {
    const page = actor.page;
    await toAudienceList(page);
    await enterAudience(page, name);
    currentAudience[actor.name] = name;
  },

  async invite(actor) {
    const page = actor.page;
    const current = currentAudience[actor.name];
    await toAudienceList(page);
    await page.getByTestId("invite-space").click();
    const link = page.getByTestId("invite-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    const text = (await link.getAttribute("title")) ?? (await link.innerText());
    await page.getByTestId("invite-modal-close").click();
    await expect(page.getByTestId("invite-modal")).toBeHidden({ timeout: 10_000 });
    if (current) await enterAudience(page, current);
    return text;
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    const input = page.getByTestId("join-input");
    await expect(input).toBeVisible({ timeout: 60_000 });
    await input.fill(link);
    await page.getByTestId("join-btn").click();
    await expect(page).toHaveURL(/\/companies\/[^/]+$/, { timeout: SYNC });
    await readyAudienceList(page);
  },

  async afterReload(actor) {
    await readyAudience(actor.page);
  },

  features: [askQuestion, publishUpdate, replyToUpdate, answerQuestion],
};
