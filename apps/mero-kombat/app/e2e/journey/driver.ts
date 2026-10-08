import { expect, type Page } from "@playwright/test";
import type { Actor, AppDriver, Feature } from "@calimero-apps/e2e-node/journey";
import { acceptInvite, createArena, mintInvite, status, takeCorner, waitForArena } from "../arena";

const SYNC = 90_000;

const seatOf = (actor: Actor) => (actor.name === "alice" ? "p1" : "p2");
const nameOf = (actor: Actor) => `${actor.name}-${actor.run}`.slice(0, 24);
const fighterOf = (actor: Actor) => (actor.name === "alice" ? "kinetic" : "inferno");

async function arenaTx(page: Page): Promise<number> {
  const text = await page.getByTestId("arena-tx").innerText();
  return Number(text.replace(/[^\d]/g, "")) || 0;
}

/** Taking a corner is the first thing that has to cross the wire. */
const corner: Feature = {
  name: "take a corner",
  async do(actor) {
    await waitForArena(actor.page);
    const mine = actor.page.getByTestId(`corner-${seatOf(actor)}`);
    if ((await mine.innerText()).includes("you")) return;
    await takeCorner(actor.page, seatOf(actor), nameOf(actor), fighterOf(actor));
  },
  async seen(viewer, by) {
    await expect(viewer.page.getByTestId(`corner-${seatOf(by)}`)).toContainText(nameOf(by), { timeout: SYNC });
  },
};

let before = 0;

/** Blows are transactions: the other node's count has to move. */
const blows: Feature = {
  name: "throw punches and kicks",
  async do(actor) {
    const page = actor.page;
    await expect(status(page)).toContainText(/Round \d+ · live/, { timeout: SYNC });
    before = await arenaTx(page);
    await page.locator("canvas.arena-canvas").click();
    // Past the bell.
    await page.waitForTimeout(2_500);
    for (const key of ["KeyJ", "KeyK", "KeyJ", "KeyW", "KeyJ", "KeyK"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(700);
    }
    await expect.poll(() => arenaTx(page), { timeout: SYNC }).toBeGreaterThanOrEqual(before + 4);
  },
  async seen(viewer) {
    await expect.poll(() => arenaTx(viewer.page), { timeout: SYNC }).toBeGreaterThanOrEqual(before + 4);
  },
};

export const driver: AppDriver = {
  app: "mero-kombat",

  async createNamespace(actor) {
    await createArena(actor.page);
  },

  async invite(actor) {
    return mintInvite(actor.page);
  },

  async acceptInvite(actor, link) {
    await acceptInvite(actor.page, link);
  },

  async afterReload(actor) {
    await waitForArena(actor.page);
  },

  features: [corner, blows],
};
