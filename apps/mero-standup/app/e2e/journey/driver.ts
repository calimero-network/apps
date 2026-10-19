import { expect, type Locator, type Page } from "@playwright/test";
import type {
  Actor,
  AppDriver,
  Feature,
} from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

const btn = (scope: Page | Locator, name: string) =>
  scope.getByRole("button", { name, exact: true });
const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });

/** Inside a team: the account menu shows who you are once the contract has answered. */
async function waitForTeam(page: Page): Promise<void> {
  await expect(page.getByTestId("my-name")).toBeVisible({ timeout: 60_000 });
}

async function openTab(
  page: Page,
  name: "Standup" | "Decisions" | "Invite",
): Promise<void> {
  await waitForTeam(page);
  const tab = page.getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** What each actor last did, by feature; module state, reset by `createNamespace`. */
const posted: Record<string, string> = {};
const decided: Record<string, string> = {};
const named: Record<string, string> = {};
let edits = 0;

function stamp(actor: Actor, what: string): string {
  return `${what} ${actor.name} ${actor.run} #${++edits}`;
}

/** Today's update: the app's core write. A second one edits the first rather than posting again. */
const postUpdate: Feature = {
  name: "post today's update",
  async do(actor) {
    const page = actor.page;
    await openTab(page, "Standup");
    const text = stamp(actor, "Shipped");
    posted[actor.name] = text;
    // Until the board has read today's updates the form shows empty; once the
    // read lands with yours in it, the form is swapped for "my-update" and a
    // fill already under way loses its textbox.
    await expect(page.locator("p.empty", { hasText: "Loading…" })).toHaveCount(0, { timeout: SYNC });
    const mine = page.getByTestId("my-update");
    if (await mine.isVisible()) await btn(mine, "Edit").click();
    await field(page, "done").fill(text);
    await field(page, "next").fill(`Next for ${actor.name}`);
    await page.locator("form.my-form button[type=submit]").click();
    await expect(mine).toContainText(text, { timeout: 30_000 });
  },
  async seen(viewer, by) {
    const text = posted[by.name];
    if (!text) throw new Error(`${by.name} has not posted yet`);
    const page = viewer.page;
    await openTab(page, "Standup");
    const where: Locator =
      by.name === viewer.name
        ? page.getByTestId("my-update")
        : page.locator("ul.updates");
    await expect(where).toContainText(text, { timeout: SYNC });
  },
};

/** The decision log: write-once records any member may add. */
const logDecision: Feature = {
  name: "log a decision",
  async do(actor) {
    const page = actor.page;
    await openTab(page, "Decisions");
    const title = stamp(actor, "Decided");
    decided[actor.name] = title;
    await page.getByRole("button", { name: /^\+ Log a decision$/ }).click();
    await page.getByLabel("decision title").fill(title);
    await page
      .getByLabel("decision", { exact: true })
      .fill(`What ${actor.name} decided`);
    await page.getByLabel("rationale").fill("Because the journey says so");
    await btn(page, "Log decision").click();
    await expect(page.getByTestId("decisions")).toContainText(title, {
      timeout: 30_000,
    });
  },
  async seen(viewer, by) {
    const title = decided[by.name];
    if (!title) throw new Error(`${by.name} has not logged a decision yet`);
    await openTab(viewer.page, "Decisions");
    await expect(viewer.page.getByTestId("decisions")).toContainText(title, {
      timeout: SYNC,
    });
  },
};

/** The team's name, which any member may change from the top bar. */
const renameTeam: Feature = {
  name: "rename the team",
  async do(actor) {
    const page = actor.page;
    await waitForTeam(page);
    const name = stamp(actor, "Team").slice(0, 80);
    named[actor.name] = name;
    await page.getByTestId("team-name").click();
    await page.getByLabel("team name").fill(name);
    await btn(page, "Save").click();
    await expect(page.getByTestId("team-name")).toContainText(name, {
      timeout: 30_000,
    });
  },
  async seen(viewer, by) {
    const name = named[by.name];
    if (!name) throw new Error(`${by.name} has not renamed the team yet`);
    await waitForTeam(viewer.page);
    await expect(viewer.page.getByTestId("team-name")).toContainText(name, {
      timeout: SYNC,
    });
  },
};

export const driver: AppDriver = {
  app: "mero-standup",

  async createNamespace(actor, name) {
    const page = actor.page;
    for (const state of [posted, decided, named])
      for (const key of Object.keys(state)) delete state[key];
    const start = btn(page, "Start a new team");
    await expect(start).toBeEnabled({ timeout: 60_000 });
    await page.getByLabel("new team name").fill(name);
    await start.click();
    await waitForTeam(page);
    await expect(page.getByTestId("team-name")).toContainText(name, {
      timeout: 30_000,
    });
  },

  async invite(actor) {
    const page = actor.page;
    await openTab(page, "Invite");
    const card = page.locator(".card", {
      has: page.getByRole("heading", { name: "Invite a teammate" }),
    });
    await btn(card, "Create invite link").click();
    const link = card.locator("code.invite-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    const href = (await link.getAttribute("title")) ?? (await link.innerText());
    await openTab(page, "Standup");
    return href;
  },

  async joined(actor) {
    const page = actor.page;
    const landed = waitForTeam(page);
    const refused = page
      .getByTestId("invite-error")
      .waitFor({ state: "visible", timeout: SYNC })
      .then(async () => {
        throw new Error(
          `join refused: ${await page.getByTestId("invite-error").innerText()}`,
        );
      });
    landed.catch(() => undefined);
    refused.catch(() => undefined);
    await Promise.race([landed, refused]);
  },

  async afterReload(actor) {
    await waitForTeam(actor.page);
  },

  features: [postUpdate, logDecision, renameTeam],
};
