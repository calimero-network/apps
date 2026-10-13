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

// ── Board navigation ──────────────────────────────────────────────────
//
// A "space" is a folder holding one board of the same name, with a "Todo"
// list. Every feature acts on the board the actor currently has open, which
// the lifecycle keeps the same for both actors (createSpace / openSpace).

/** The space (folder + board name) each actor last opened. */
const spaceOf: Partial<Record<Actor["name"], string>> = {};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listCol(page: Page, name: string): Locator {
  return page
    .getByTestId("item-list")
    .filter({ has: page.getByTestId("list-title").filter({ hasText: new RegExp(`^${escapeRe(name)}$`) }) });
}

function cardTile(page: Page | Locator, title: string): Locator {
  return page.getByTestId("item-card").filter({ hasText: title });
}

async function closeCard(actor: Actor): Promise<void> {
  const modal = actor.page.getByTestId("card-modal");
  if (!(await modal.isVisible().catch(() => false))) return;
  await actor.page.getByTestId("action-close").click();
  await expect(modal).toHaveCount(0, { timeout: 10_000 });
}

/** Open `name`'s folder from the sidebar and its board from the folder page. */
async function openBoard(actor: Actor, name: string): Promise<void> {
  const page = actor.page;
  await closeCard(actor);
  if ((await page.getByTestId("board-name").innerText().catch(() => "")) === name) return;
  const folder = page.getByTestId("folder-list-item").filter({ hasText: new RegExp(`^${escapeRe(name)}$`) });
  await eventually(actor, async () => (await folder.count()) > 0, `${actor.name} sees the folder ${name}`);
  await press(actor, folder.first());
  await expect(page.getByTestId("folder-header-name")).toHaveText(name, { timeout: 30_000 });
  await waitForBoard(actor);
  await expect(page.getByTestId("folder-page")).toBeVisible({ timeout: 30_000 });
  const tile = page.getByTestId("item-board").filter({ hasText: name });
  await eventually(actor, async () => (await tile.count()) > 0, `${actor.name} sees the board ${name}`);
  await press(actor, tile.first());
  await expect(page.getByTestId("board-name")).toHaveText(name, { timeout: 30_000 });
  spaceOf[actor.name] = name;
}

/** Make sure the actor is on their board with no card open. */
async function onBoard(actor: Actor): Promise<void> {
  await closeCard(actor);
  const name = spaceOf[actor.name];
  if (!name) throw new Error(`${actor.name} has no board open`);
  await openBoard(actor, name);
}

async function addList(actor: Actor, name: string): Promise<void> {
  const page = actor.page;
  const input = page.getByTestId("list-create-input");
  if (!(await input.isVisible().catch(() => false))) {
    const btn = page.getByTestId("list-create-btn");
    await expect(btn).toBeEnabled({ timeout: 30_000 });
    await press(actor, btn);
  }
  await input.fill(name);
  await page.getByTestId("list-create-submit").click();
  await expect(listCol(page, name)).toBeVisible({ timeout: 30_000 });
}

/** Mouse drag through dnd-kit: a short move arms the PointerSensor (> 6 px), a long one carries the card. */
async function dragCard(actor: Actor, title: string, toList: string): Promise<void> {
  const page = actor.page;
  const card = cardTile(page, title).first();
  const target = listCol(page, toList);
  await card.scrollIntoViewIfNeeded();
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  const x0 = from.x + from.width / 2;
  const y0 = from.y + from.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 12, y0 + 12, { steps: 6 });
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(60, to.height / 2), { steps: 20 });
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(64, to.height / 2), { steps: 2 });
  await page.mouse.up();
  await expect(cardTile(target, title)).toBeVisible({ timeout: 15_000 });
}

async function openCard(actor: Actor, title: string): Promise<void> {
  const page = actor.page;
  await press(actor, cardTile(page, title).first());
  await expect(page.getByTestId("card-modal")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("field-title")).toHaveValue(title, { timeout: 30_000 });
}

/** Open a card if it is on the board, run `check` inside its modal, close it again. */
async function inCard(actor: Actor, title: string, check: () => Promise<boolean>): Promise<boolean> {
  await onBoard(actor);
  if ((await cardTile(actor.page, title).count()) === 0) return false;
  await openCard(actor, title);
  try {
    return await check();
  } finally {
    await closeCard(actor);
  }
}

// ── Features ──────────────────────────────────────────────────────────

const cards: Record<string, { title: string }> = {};
const moves: Record<string, { title: string }> = {};
const comments: Record<string, { title: string; body: string }> = {};
const labels: Record<string, { title: string; label: string }> = {};

function someCard(actor: Actor): string {
  const target = cards[other(actor)] ?? cards[actor.name];
  if (!target) throw new Error("no card yet");
  return target.title;
}

const createCard: Feature = {
  name: "create a card",
  async do(actor) {
    const page = actor.page;
    const title = `card ${actor.name} ${actor.run} ${stamp()}`;
    cards[actor.name] = { title };
    await onBoard(actor);
    const todo = listCol(page, "Todo");
    await expect(todo).toBeVisible({ timeout: 30_000 });
    const input = todo.getByTestId("card-create-input");
    if (!(await input.isVisible().catch(() => false))) await press(actor, todo.getByTestId("card-create-btn"));
    await input.fill(title);
    await todo.getByTestId("card-create-submit").click();
    await expect(cardTile(todo, title)).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor, by) {
    const c = cards[by.name];
    if (!c) throw new Error(`${by.name} has not created a card yet`);
    await eventually(
      actor,
      async () => {
        await onBoard(actor);
        return (await cardTile(actor.page, c.title).count()) > 0;
      },
      `${actor.name} sees ${by.name}'s card`,
    );
  },
};

const moveCard: Feature = {
  name: "move a card",
  async do(actor) {
    const page = actor.page;
    const own = cards[actor.name];
    if (!own) throw new Error(`${actor.name} has no card to move`);
    moves[actor.name] = { title: own.title };
    await onBoard(actor);
    await expect(cardTile(page, own.title)).toBeVisible({ timeout: 30_000 });
    if ((await listCol(page, "Doing").count()) === 0) await addList(actor, "Doing");
    await dragCard(actor, own.title, "Doing");
  },
  async seen(actor, by) {
    const m = moves[by.name];
    if (!m) throw new Error(`${by.name} has not moved a card yet`);
    await eventually(
      actor,
      async () => {
        await onBoard(actor);
        return (await cardTile(listCol(actor.page, "Doing"), m.title).count()) > 0;
      },
      `${actor.name} sees ${by.name}'s card in Doing`,
    );
  },
};

const addComment: Feature = {
  name: "comment on a card",
  async do(actor) {
    const page = actor.page;
    const title = someCard(actor);
    const body = `comment ${actor.name} ${actor.run} ${stamp()}`;
    comments[actor.name] = { title, body };
    await onBoard(actor);
    await openCard(actor, title);
    await page.getByTestId("field-body").fill(body);
    await page.getByTestId("action-add_comment").click();
    await expect(page.getByTestId("item-comment").filter({ hasText: body })).toBeVisible({ timeout: 30_000 });
    await closeCard(actor);
  },
  async seen(actor, by) {
    const c = comments[by.name];
    if (!c) throw new Error(`${by.name} has not commented yet`);
    await eventually(
      actor,
      () =>
        inCard(actor, c.title, async () =>
          actor.page
            .getByTestId("item-comment")
            .filter({ hasText: c.body })
            .first()
            .waitFor({ state: "visible", timeout: 3_000 })
            .then(() => true, () => false),
        ),
      `${actor.name} sees ${by.name}'s comment`,
    );
  },
};

const addLabel: Feature = {
  name: "label a card",
  async do(actor) {
    const page = actor.page;
    const title = someCard(actor);
    const label = `l-${actor.name}-${stamp()}`;
    labels[actor.name] = { title, label };
    await onBoard(actor);
    await openCard(actor, title);
    await press(actor, page.getByTestId("action-add_label"));
    await page.getByTestId("field-label").fill(label);
    await page.getByTestId("label-submit").click();
    await expect(page.getByLabel(`Remove ${label}`, { exact: true })).toHaveCount(1, { timeout: 30_000 });
    await closeCard(actor);
  },
  async seen(actor, by) {
    const l = labels[by.name];
    if (!l) throw new Error(`${by.name} has not labelled anything yet`);
    await eventually(
      actor,
      async () => {
        await onBoard(actor);
        return (await cardTile(actor.page, l.title).filter({ hasText: l.label }).count()) > 0;
      },
      `${actor.name} sees ${by.name}'s label`,
    );
  },
};

export const driver: AppDriver = {
  app: "mero-board",

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

  /** A folder, a board of the same name in it, and its first list "Todo". */
  async createSpace(actor, name) {
    const page = actor.page;
    await closeCard(actor);
    await press(actor, page.getByTestId("folder-add-btn"));
    await page.getByTestId("folder-add-name").fill(name);
    await page.getByTestId("folder-add-submit").click();
    await expect(page.getByTestId("folder-add-name")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("folder-header-name")).toHaveText(name, { timeout: 30_000 });
    await waitForBoard(actor);
    await expect(page.getByTestId("folder-page")).toBeVisible({ timeout: 30_000 });
    const create = page.getByTestId("board-create-btn");
    await expect(create).toBeEnabled({ timeout: 30_000 });
    await press(actor, create);
    await page.getByTestId("board-create-input").fill(name);
    await page.getByTestId("board-create-submit").click();
    await expect(page.getByTestId("board-name")).toHaveText(name, { timeout: 30_000 });
    spaceOf[actor.name] = name;
    await addList(actor, "Todo");
  },

  async openSpace(actor, name) {
    await openBoard(actor, name);
    await eventually(
      actor,
      async () => {
        await onBoard(actor);
        return (await listCol(actor.page, "Todo").count()) > 0;
      },
      `${actor.name} sees the Todo list of ${name}`,
    );
  },

  async invite(actor) {
    const page = actor.page;
    await closeCard(actor);
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
    if (spaceOf[actor.name]) await onBoard(actor);
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

  features: [createCard, moveCard, addComment, addLabel],
};
