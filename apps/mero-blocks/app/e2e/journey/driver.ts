import { expect, type Page } from "@playwright/test";
import { completeNodeLogin, readClipboard, type Actor, type AppDriver, type Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;
const AIR = 0;
const BRICK = 10;
const GLOWSTONE = 12;

interface MbHandle {
  world: { getBlock(x: number, y: number, z: number): number };
  sync: { pending: Map<string, unknown> } | null;
  editBlock(x: number, y: number, z: number, b: number): void;
}

type MbWindow = Window & { __mb?: MbHandle };

interface Block {
  x: number;
  y: number;
  z: number;
  b: number;
}

const blocks: Record<string, Block> = {};
const broken: Record<string, Block> = {};
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
        return page.evaluate(() => Boolean((window as MbWindow).__mb));
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

async function blockAt(page: Page, at: Block): Promise<number> {
  return page.evaluate(({ x, y, z }) => (window as MbWindow).__mb?.world.getBlock(x, y, z) ?? -1, at);
}

async function edit(page: Page, at: Block): Promise<void> {
  await page.evaluate(({ x, y, z, b }) => (window as MbWindow).__mb?.editBlock(x, y, z, b), at);
  await expect.poll(() => blockAt(page, at), { timeout: 10_000 }).toBe(at.b);
  await expect
    .poll(() => page.evaluate(() => (window as MbWindow).__mb?.sync?.pending.size ?? -1), { timeout: 30_000 })
    .toBe(0);
}

async function seeBlock(page: Page, at: Block): Promise<void> {
  await expect
    .poll(() => blockAt(page, at), {
      timeout: SYNC,
      intervals: [1_000, 2_000, 3_000],
      message: `block ${at.x},${at.y},${at.z} is ${at.b}`,
    })
    .toBe(at.b);
}

const placeBlock: Feature = {
  name: "place a block",
  async do(actor: Actor) {
    placements += 1;
    const at: Block = {
      x: 8 + placements * 3,
      y: 60,
      z: actor.name === "alice" ? 100 : 110,
      b: actor.name === "alice" ? BRICK : GLOWSTONE,
    };
    blocks[actor.name] = at;
    await edit(actor.page, at);
  },
  async seen(actor: Actor, by: Actor) {
    const at = blocks[by.name];
    if (!at) throw new Error(`${by.name} has not placed a block yet`);
    await seeBlock(actor.page, at);
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

const breakBlock: Feature = {
  name: "break the other player's block",
  oneWay: true,
  async do(actor: Actor) {
    const other = actor.name === "alice" ? "bob" : "alice";
    const target = blocks[other];
    if (!target) throw new Error(`${other} has placed no block to break`);
    const at: Block = { ...target, b: AIR };
    blocks[other] = at;
    broken[actor.name] = at;
    await edit(actor.page, at);
  },
  async seen(actor: Actor, by: Actor) {
    const at = broken[by.name];
    if (!at) throw new Error(`${by.name} has not broken a block yet`);
    await seeBlock(actor.page, at);
  },
};

export const driver: AppDriver = {
  app: "mero-blocks",

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
            if (await page.evaluate(() => Boolean((window as MbWindow).__mb))) return "game";
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
          (await page.evaluate(() => Boolean((window as MbWindow).__mb))) || (await enter.isVisible()),
        { timeout: 60_000 },
      )
      .toBe(true);
    if (await enter.isVisible()) await enter.click();
    await waitForGame(page);
  },

  features: [placeBlock, seePlayer, breakBlock],
};
