import { expect, type Locator, type Page } from "@playwright/test";
import { defaultLogin, type Actor, type AppDriver, type Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

let teamId = "";
let counter = 0;
const events: Record<string, string[]> = {};
const removed: Record<string, string> = {};

function nextTitle(actor: Actor, kind: string): string {
  counter += 1;
  return `${actor.name}-${kind}-${actor.run}-${counter}`;
}

function chip(page: Page, title: string): Locator {
  return page.getByTestId("event-chip").filter({ hasText: title });
}

function latest(name: string): string {
  const list = events[name];
  const title = list?.[list.length - 1];
  if (!title) throw new Error(`${name} has no event on record`);
  return title;
}

async function waitForCalendar(page: Page): Promise<void> {
  await expect(page.getByTestId("add-event-btn")).toBeVisible({ timeout: 60_000 });
  const modal = page.getByTestId("username-modal");
  if (await modal.isVisible()) {
    await page.getByTestId("username-input").fill(`user-${Date.now().toString(36)}`);
    await page.getByTestId("username-submit").click();
    await expect(modal).toBeHidden({ timeout: 15_000 });
  }
}

async function goTeams(page: Page): Promise<void> {
  if (!(await page.getByTestId("create-team-btn").isVisible())) await page.goto("/teams");
  await expect(page.getByTestId("create-team-btn")).toBeVisible({ timeout: 60_000 });
}

async function goTeam(page: Page): Promise<void> {
  if (!teamId) throw new Error("no team has been created yet");
  if (await page.getByTestId("create-calendar-btn").isVisible()) return;
  await goTeams(page);
  const card = page.getByTestId(`team-card-${teamId}`);
  await expect
    .poll(
      async () => {
        if (await card.isVisible()) return true;
        await page.reload();
        await expect(page.getByTestId("create-team-btn")).toBeVisible({ timeout: 30_000 });
        return card.isVisible();
      },
      { timeout: SYNC, intervals: [2_000, 5_000] },
    )
    .toBe(true);
  await card.click();
  await expect(page.getByTestId("create-calendar-btn")).toBeVisible({ timeout: 30_000 });
}

async function openEventPopup(page: Page, title: string): Promise<void> {
  await chip(page, title).first().click();
}

async function eventually(page: Page, check: () => Promise<boolean>): Promise<void> {
  await expect
    .poll(
      async () => {
        if (await check()) return true;
        await page.reload();
        await waitForCalendar(page);
        return check();
      },
      { timeout: SYNC, intervals: [3_000, 5_000, 8_000] },
    )
    .toBe(true);
}

async function createEvent(actor: Actor): Promise<void> {
  const page = actor.page;
  await waitForCalendar(page);
  const title = nextTitle(actor, "event");
  (events[actor.name] ??= []).push(title);
  await page.getByTestId("add-event-btn").click();
  await page.getByPlaceholder("Title", { exact: true }).fill(title);
  await page.getByTestId("event-submit").click();
  await expect(page.getByTestId("event-submit")).toBeHidden({ timeout: 30_000 });
  await expect(chip(page, title)).toBeVisible({ timeout: 30_000 });
}

async function seeLatest(actor: Actor, by: Actor): Promise<void> {
  const title = latest(by.name);
  await eventually(actor.page, async () => (await chip(actor.page, title).count()) > 0);
}

const createFeature: Feature = {
  name: "create an event",
  do: createEvent,
  seen: seeLatest,
};

const editFeature: Feature = {
  name: "edit my event's title",
  async do(actor: Actor) {
    const page = actor.page;
    await waitForCalendar(page);
    const list = events[actor.name];
    const old = latest(actor.name);
    const title = nextTitle(actor, "edited");
    await openEventPopup(page, old);
    await page.getByTestId("popup-edit").click();
    const field = page.getByPlaceholder("Title", { exact: true });
    await field.fill(title);
    await page.getByTestId("event-submit").click();
    await expect(page.getByTestId("event-submit")).toBeHidden({ timeout: 30_000 });
    await expect(chip(page, title)).toBeVisible({ timeout: 30_000 });
    if (list) list[list.length - 1] = title;
    removed[actor.name] = old;
  },
  async seen(actor: Actor, by: Actor) {
    const title = latest(by.name);
    const old = removed[by.name] ?? "";
    await eventually(
      actor.page,
      async () => (await chip(actor.page, title).count()) > 0 && (await chip(actor.page, old).count()) === 0,
    );
  },
};

const deleteFeature: Feature = {
  name: "delete my event",
  async do(actor: Actor) {
    const page = actor.page;
    await waitForCalendar(page);
    const title = latest(actor.name);
    await openEventPopup(page, title);
    await page.getByTestId("popup-delete").click();
    await expect(chip(page, title)).toHaveCount(0, { timeout: 30_000 });
    events[actor.name]?.pop();
    removed[actor.name] = title;
  },
  async seen(actor: Actor, by: Actor) {
    const title = removed[by.name];
    if (!title) throw new Error(`${by.name} has not deleted anything`);
    await eventually(actor.page, async () => (await chip(actor.page, title).count()) === 0);
  },
};

const createAgainFeature: Feature = {
  name: "create another event after the delete",
  do: createEvent,
  seen: seeLatest,
};

export const driver: AppDriver = {
  app: "mero-calendar",

  async login(actor) {
    await defaultLogin(actor);
    await expect(actor.page.getByTestId("create-team-btn")).toBeVisible({ timeout: 60_000 });
  },

  async createNamespace(actor, name) {
    const page = actor.page;
    await goTeams(page);
    await page.getByTestId("new-team-input").fill(name);
    await page.getByTestId("create-team-btn").click();
    const card = page.locator('[data-testid^="team-card-"]', { hasText: name });
    await expect(card).toBeVisible({ timeout: 30_000 });
    const testId = (await card.first().getAttribute("data-testid")) ?? "";
    teamId = testId.replace(/^team-card-/, "");
    if (!teamId) throw new Error("the new team card carries no id");
  },

  async createSpace(actor, name) {
    const page = actor.page;
    await goTeam(page);
    await page.getByTestId("new-calendar-input").fill(name);
    await page.getByTestId("create-calendar-btn").click();
    await waitForCalendar(page);
  },

  async openSpace(actor, name) {
    const page = actor.page;
    await goTeam(page);
    const card = page.locator('[data-testid^="calendar-card-"]', { hasText: name });
    await expect
      .poll(
        async () => {
          if ((await card.count()) > 0) return true;
          await page.reload();
          await expect(page.getByTestId("create-calendar-btn")).toBeVisible({ timeout: 30_000 });
          return (await card.count()) > 0;
        },
        { timeout: SYNC, intervals: [3_000, 5_000, 8_000] },
      )
      .toBe(true);
    await card.first().click();
    await waitForCalendar(page);
  },

  async invite(actor) {
    const page = actor.page;
    await goTeams(page);
    await page.getByTestId(`team-menu-${teamId}`).click();
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    const code = page.locator(`[data-testid="copy-invite"]`).locator("xpath=..").locator("code");
    await expect(code).toBeVisible({ timeout: 30_000 });
    return (await code.getAttribute("title")) ?? "";
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    await goTeams(page);
    await page.getByTestId("join-code-input").fill(link);
    await page.getByTestId("join-team-btn").click();
    await expect(page.getByTestId(`team-card-${teamId}`)).toBeVisible({ timeout: 120_000 });
  },

  async afterReload(actor) {
    await waitForCalendar(actor.page);
  },

  features: [createFeature, editFeature, deleteFeature, createAgainFeature],
};
