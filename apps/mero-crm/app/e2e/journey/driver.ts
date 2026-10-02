import { expect, type Locator, type Page } from "@playwright/test";
import type { Actor, AppDriver, Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

function other(actor: Actor): Actor["name"] {
  return actor.name === "alice" ? "bob" : "alice";
}

function stamp(): string {
  return Date.now().toString(36);
}

async function settleAliasGate(actor: Actor, timeout = 10_000): Promise<void> {
  const page = actor.page;
  const gate = page.getByTestId("alias-gate");
  const shown = await gate
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
  if (!shown) return;
  await page.getByTestId("alias-gate-name").fill(`${actor.name}-${actor.run}`);
  await page.getByTestId("alias-gate-save").click();
  const gone = await gate
    .waitFor({ state: "detached", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!gone) {
    await page.getByTestId("alias-gate-skip").click();
    await gate.waitFor({ state: "detached", timeout: 5_000 });
  }
}

async function press(actor: Actor, target: Locator): Promise<void> {
  try {
    await target.click({ timeout: 5_000 });
  } catch {
    await settleAliasGate(actor, 5_000);
    await target.click({ timeout: 15_000 });
  }
}

async function waitForShell(actor: Actor): Promise<void> {
  const page = actor.page;
  await expect(page.getByTestId("ns-switcher").or(page.getByTestId("ns-empty-state")).first()).toBeVisible({
    timeout: 60_000,
  });
}

async function waitForBoard(actor: Actor): Promise<void> {
  await expect(actor.page.getByTestId("workspace-ready")).toBeVisible({ timeout: 60_000 });
  await settleAliasGate(actor, 3_000);
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
          await waitForBoard(actor).catch(() => undefined);
        }
        return false;
      },
      { message, timeout: SYNC, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);
}

async function openBoard(actor: Actor): Promise<void> {
  await press(actor, actor.page.getByTestId("nav-pipeline"));
  await waitForBoard(actor);
}

function dealCard(page: Page, title: string): Locator {
  return page.getByTestId("deal-card").filter({ hasText: title });
}

async function openDeal(actor: Actor, title: string): Promise<void> {
  const page = actor.page;
  await openBoard(actor);
  const card = dealCard(page, title).first();
  await expect(card).toBeVisible({ timeout: SYNC });
  await press(actor, card);
  await expect(page.getByTestId("deal-title")).toHaveText(title, { timeout: 30_000 });
}

async function onDeal(actor: Actor, title: string): Promise<boolean> {
  const page = actor.page;
  const heading = page.getByTestId("deal-title");
  if ((await heading.isVisible()) && (await heading.innerText()).trim() === title) return true;
  await press(actor, page.getByTestId("nav-pipeline"));
  const card = dealCard(page, title).first();
  if (!(await card.isVisible())) return false;
  await card.click();
  await expect(heading).toHaveText(title, { timeout: 10_000 });
  return true;
}

const deals: Record<string, { title: string }> = {};
const moves: Record<string, { title: string; stageId: string }> = {};
const notes: Record<string, { title: string; body: string }> = {};
const contacts: Record<string, { name: string }> = {};

const createDeal: Feature = {
  name: "create a deal",
  async do(actor) {
    const page = actor.page;
    const title = `deal ${actor.name} ${actor.run} ${stamp()}`;
    deals[actor.name] = { title };
    await openBoard(actor);
    await press(actor, page.getByTestId("open-new-deal-btn"));
    await page.getByTestId("deal-title-input").fill(title);
    await page.getByTestId("deal-value-input").fill("5k");
    await page.getByTestId("deal-org-input").fill(`org ${actor.run}`);
    await page.getByTestId("deal-create-submit").click();
    await expect(page.getByTestId("deal-create-submit")).toHaveCount(0, { timeout: 30_000 });
    await expect(dealCard(page, title)).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor, by) {
    const d = deals[by.name];
    if (!d) throw new Error(`${by.name} has not created a deal yet`);
    await eventually(
      actor,
      async () => {
        await press(actor, actor.page.getByTestId("nav-pipeline"));
        return (await dealCard(actor.page, d.title).count()) > 0;
      },
      `${actor.name} sees ${by.name}'s deal on the board`,
    );
  },
};

const moveDeal: Feature = {
  name: "move a deal to another stage",
  async do(actor) {
    const page = actor.page;
    const target = deals[other(actor)] ?? deals[actor.name];
    if (!target) throw new Error("no deal to move");
    const stageId = actor.name === "alice" ? "stage-meeting" : "stage-proposal";
    moves[actor.name] = { title: target.title, stageId };
    await openDeal(actor, target.title);
    const step = page.locator(`[data-testid="stage-step"][data-stage-id="${stageId}"]`);
    await press(actor, step);
    await expect(step).toHaveClass(/current/, { timeout: 30_000 });
  },
  async seen(actor, by) {
    const m = moves[by.name];
    if (!m) throw new Error(`${by.name} has not moved a deal yet`);
    await eventually(
      actor,
      async () => {
        await press(actor, actor.page.getByTestId("nav-pipeline"));
        const column = actor.page.locator(`[data-testid="stage-column"][data-stage-id="${m.stageId}"]`);
        return (await column.getByTestId("deal-card").filter({ hasText: m.title }).count()) > 0;
      },
      `${actor.name} sees ${by.name}'s deal in ${m.stageId}`,
    );
  },
};

const addNote: Feature = {
  name: "add a note to a deal",
  async do(actor) {
    const page = actor.page;
    const target = deals[other(actor)] ?? deals[actor.name];
    if (!target) throw new Error("no deal to note");
    const body = `note ${actor.name} ${actor.run} ${stamp()}`;
    notes[actor.name] = { title: target.title, body };
    await openDeal(actor, target.title);
    await page.getByTestId("note-input").fill(body);
    await page.getByTestId("note-add").click();
    await expect(page.getByTestId("deal-note").filter({ hasText: body })).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor, by) {
    const n = notes[by.name];
    if (!n) throw new Error(`${by.name} has not added a note yet`);
    await eventually(
      actor,
      async () =>
        (await onDeal(actor, n.title)) &&
        (await actor.page.getByTestId("deal-note").filter({ hasText: n.body }).count()) > 0,
      `${actor.name} sees ${by.name}'s note`,
    );
  },
};

const addContact: Feature = {
  name: "add a contact",
  async do(actor) {
    const page = actor.page;
    const name = `person ${actor.name} ${actor.run} ${stamp()}`;
    contacts[actor.name] = { name };
    await press(actor, page.getByTestId("nav-contacts"));
    await press(actor, page.getByTestId("new-contact-btn"));
    await page.getByTestId("contact-name").fill(name);
    await page.getByTestId("contact-organization").fill(`org ${actor.run}`);
    await page.getByTestId("contact-email").fill(`${actor.name}.${actor.run}@example.com`);
    await page.getByTestId("contact-save").click();
    await expect(page.getByTestId("contact-save")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("contact-row").filter({ hasText: name })).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor, by) {
    const c = contacts[by.name];
    if (!c) throw new Error(`${by.name} has not added a contact yet`);
    await eventually(
      actor,
      async () => {
        await press(actor, actor.page.getByTestId("nav-contacts"));
        return (await actor.page.getByTestId("contact-row").filter({ hasText: c.name }).count()) > 0;
      },
      `${actor.name} sees ${by.name}'s contact`,
    );
  },
};

export const driver: AppDriver = {
  app: "mero-crm",

  async createNamespace(actor, name) {
    const page = actor.page;
    await waitForShell(actor);
    await press(actor, page.getByTestId("ns-create-btn").first());
    await page.getByTestId("ns-create-name").fill(name);
    await page.getByTestId("ns-create-submit").click();
    await expect(page.getByTestId("ns-create-name")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("ns-switcher")).toContainText(name, { timeout: 30_000 });
    await settleAliasGate(actor);
  },

  async createSpace(actor, name) {
    const page = actor.page;
    await press(actor, page.getByTestId("pipeline-add-btn"));
    await page.getByTestId("pipeline-add-name").fill(name);
    await page.getByTestId("pipeline-add-currency").fill("USD");
    await page.getByTestId("pipeline-add-submit").click();
    await expect(page.getByTestId("pipeline-add-name")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("pipeline-header-name")).toHaveText(name, { timeout: 30_000 });
    await waitForBoard(actor);
  },

  async openSpace(actor, name) {
    const page = actor.page;
    const item = page.getByTestId("pipeline-list-item").filter({ hasText: name });
    await eventually(actor, async () => (await item.count()) > 0, `${actor.name} sees the pipeline ${name}`);
    await press(actor, item.first());
    await expect(page.getByTestId("pipeline-header-name")).toHaveText(name, { timeout: 30_000 });
    await waitForBoard(actor);
  },

  async invite(actor) {
    const page = actor.page;
    await press(actor, page.getByTestId("nav-members"));
    const nudge = page.getByTestId("alias-input");
    if (await nudge.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) {
      await page.keyboard.press("Escape");
      await expect(nudge).toHaveCount(0, { timeout: 5_000 });
    }
    const open = page.getByTestId("open-invite-btn");
    await expect(open).toBeEnabled({ timeout: 30_000 });
    await press(actor, open);
    await page.getByTestId("generate-invite-btn").click();
    const output = page.getByTestId("invite-code-output");
    await expect(output).not.toHaveValue("", { timeout: 30_000 });
    const link = (await output.inputValue()).trim();
    await page.keyboard.press("Escape");
    await expect(output).toHaveCount(0, { timeout: 5_000 });
    await openBoard(actor);
    return link;
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    await waitForShell(actor);
    await press(actor, page.getByTestId("ns-join-btn").first());
    await page.getByTestId("join-code-input").fill(link);
    await page.getByTestId("join-submit-btn").click();
    await expect(page.getByTestId("join-code-input")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId("ns-switcher")).toBeVisible({ timeout: 30_000 });
    await settleAliasGate(actor);
  },

  async afterReload(actor) {
    await waitForBoard(actor);
  },

  features: [createDeal, moveDeal, addNote, addContact],
};
