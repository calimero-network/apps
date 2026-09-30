import { expect, type Page } from "@playwright/test";
import { completeNodeLogin, readClipboard, type Actor, type AppDriver, type Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;
const AIR = 0;
const PLANK = 7;
const BRICK = 14;

interface MtHandle {
  world: { getTile(x: number, y: number): number };
  sync: { pending: Map<string, unknown> } | null;
  editTile(x: number, y: number, t: number): boolean;
}

type MtWindow = Window & { __mt?: MtHandle };

interface Tile {
  x: number;
  y: number;
  t: number;
}

const tiles: Record<string, Tile> = {};
const broken: Record<string, Tile> = {};
let placements = 0;

function playerName(actor: Actor): string {
  return `${actor.name}-${actor.run}`.slice(0, 16);
}

async function waitForGame(page: Page, timeout = 60_000): Promise<void> {
  const fatal = page.getByTestId("fatal-message");
  await expect
    .poll(
      async () => {
        if (await fatal.isVisible().catch(() => false)) {
          throw new Error(`the game refused to start: ${await fatal.innerText()}`);
        }
        return page.evaluate(() => Boolean((window as MtWindow).__mt));
      },
      { timeout, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);
  await expect(page.getByTestId("debug")).toContainText("online", { timeout: 30_000 });
}

async function waitForPicker(page: Page): Promise<void> {
  await expect(page.getByTestId("create-world-open-btn")).toBeVisible({ timeout: 60_000 });
}

async function setPlayerName(actor: Actor): Promise<void> {
  await actor.page.getByTestId("name-input").fill(playerName(actor));
}

async function tileAt(page: Page, at: Tile): Promise<number> {
  return page.evaluate(({ x, y }) => (window as MtWindow).__mt?.world.getTile(x, y) ?? -1, at);
}

async function edit(page: Page, at: Tile): Promise<void> {
  await page.evaluate(({ x, y, t }) => (window as MtWindow).__mt?.editTile(x, y, t), at);
  await expect.poll(() => tileAt(page, at), { timeout: 10_000 }).toBe(at.t);
  await expect
    .poll(() => page.evaluate(() => (window as MtWindow).__mt?.sync?.pending.size ?? -1), { timeout: 30_000 })
    .toBe(0);
}

async function seeTile(page: Page, at: Tile): Promise<void> {
  await expect
    .poll(() => tileAt(page, at), {
      timeout: SYNC,
      intervals: [1_000, 2_000, 3_000],
      message: `tile ${at.x},${at.y} is ${at.t}`,
    })
    .toBe(at.t);
}

const placeTile: Feature = {
  name: "place a tile",
  async do(actor: Actor) {
    placements += 1;
    const at: Tile = {
      x: 20 + placements * 3,
      y: actor.name === "alice" ? 3 : 6,
      t: actor.name === "alice" ? BRICK : PLANK,
    };
    tiles[actor.name] = at;
    await edit(actor.page, at);
  },
  async seen(actor: Actor, by: Actor) {
    const at = tiles[by.name];
    if (!at) throw new Error(`${by.name} has not placed a tile yet`);
    await seeTile(actor.page, at);
  },
};

const seePlayer: Feature = {
  name: "see the other player",
  async do(actor: Actor) {
    await expect(actor.page.getByTestId("players")).toContainText(`${playerName(actor)} (you)`, {
      timeout: 30_000,
    });
  },
  async seen(actor: Actor, by: Actor) {
    await expect(actor.page.getByTestId("players")).toContainText(playerName(by), { timeout: SYNC });
  },
};

const digTile: Feature = {
  name: "dig out the other player's tile",
  oneWay: true,
  async do(actor: Actor) {
    const other = actor.name === "alice" ? "bob" : "alice";
    const target = tiles[other];
    if (!target) throw new Error(`${other} has placed no tile to dig`);
    const at: Tile = { ...target, t: AIR };
    tiles[other] = at;
    broken[actor.name] = at;
    await edit(actor.page, at);
  },
  async seen(actor: Actor, by: Actor) {
    const at = broken[by.name];
    if (!at) throw new Error(`${by.name} has not dug a tile yet`);
    await seeTile(actor.page, at);
  },
};

export const driver: AppDriver = {
  app: "merraria",

  async login(actor) {
    const page = actor.page;
    const marketing = page.getByRole("button", { name: "Connect to node", exact: true }).first();
    const open = page.getByTestId("connect-open-btn");
    await expect(marketing.or(open).first()).toBeVisible({ timeout: 30_000 });
    if (await marketing.isVisible()) await marketing.click();
    await open.click();
    const modal = page.getByTestId("connect-modal");
    await modal.getByTestId("node-url-input").fill(actor.node.url);
    await modal.getByTestId("web-login-btn").click();
    await completeNodeLogin(page, actor.node.url);
    await waitForPicker(page);
    await setPlayerName(actor);
  },

  async createNamespace(actor, name) {
    const page = actor.page;
    await waitForPicker(page);
    await setPlayerName(actor);
    await page.getByTestId("create-world-open-btn").click();
    const modal = page.getByTestId("create-modal");
    await modal.getByTestId("world-name-input").fill(name.slice(0, 24));
    await modal.getByTestId("create-world-btn").click();
    await waitForGame(page);
  },

  async invite(actor) {
    const page = actor.page;
    await page.keyboard.press("KeyO");
    const overlay = page.getByTestId("options-overlay");
    const button = overlay.getByTestId("invite-btn");
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();
    await expect(button).toHaveText("Invite copied!", { timeout: 30_000 });
    const link = (await readClipboard(page)).trim();
    await overlay.getByTestId("resume-btn").click();
    return link;
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    await waitForPicker(page);
    await setPlayerName(actor);
    await page.getByTestId("join-invite-open-btn").click();
    const modal = page.getByTestId("invite-modal");
    await modal.getByTestId("invite-input").fill(link);
    const join = modal.getByTestId("join-invite-btn");
    const error = modal.getByTestId("picker-error");
    const deadline = Date.now() + SYNC;
    for (;;) {
      await join.click();
      await expect
        .poll(
          async () => {
            if (await page.evaluate(() => Boolean((window as MtWindow).__mt))) return "game";
            if (!(await modal.isVisible().catch(() => false))) return "left";
            const text = (await error.innerText().catch(() => "")).trim();
            return text && (await join.isEnabled().catch(() => false)) ? "error" : "busy";
          },
          { timeout: SYNC, intervals: [500, 1_000, 2_000] },
        )
        .not.toBe("busy");
      if (!(await modal.isVisible().catch(() => false))) break;
      if (Date.now() > deadline) throw new Error(`joining the world failed: ${await error.innerText()}`);
      await page.waitForTimeout(3_000);
    }
    await waitForGame(page, SYNC);
  },

  async afterReload(actor) {
    const page = actor.page;
    const enter = page.getByTestId("connect-btn");
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => Boolean((window as MtWindow).__mt))) || (await enter.isVisible()),
        { timeout: 60_000 },
      )
      .toBe(true);
    if (await enter.isVisible()) await enter.click();
    await waitForGame(page);
  },

  features: [placeTile, seePlayer, digTile],
};
