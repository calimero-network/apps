/**
 * Arena steps shared by the two-node lifecycle journey and the recorded duel.
 * Everything goes through the UI a player sees — no contract calls from here.
 */
import { expect, type Locator, type Page } from "@playwright/test";

export function card(page: Page, heading: string): Locator {
  return page.locator(".card", { has: page.getByRole("heading", { name: heading, exact: true }) });
}

export async function waitForArena(page: Page): Promise<void> {
  await expect(page.locator("canvas.arena-canvas")).toBeVisible({ timeout: 90_000 });
}

export async function createArena(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Choose an arena", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "New arena", exact: true }).click({ timeout: 30_000 });
  await waitForArena(page);
}

export async function mintInvite(page: Page): Promise<string> {
  const invite = card(page, "Invite an opponent");
  await invite.getByRole("button", { name: "Create invite link", exact: true }).click({ timeout: 30_000 });
  const link = invite.locator("code.invite-link");
  await expect(link).toBeVisible({ timeout: 30_000 });
  return (await link.getAttribute("title")) ?? (await link.innerText());
}

export async function acceptInvite(page: Page, link: string): Promise<void> {
  const join = card(page, "Join with an invitation");
  await expect(join).toBeVisible({ timeout: 60_000 });
  await join.getByLabel("invitation", { exact: true }).fill(link);
  await join.getByRole("button", { name: "Join", exact: true }).first().click();
  await waitForArena(page);
}

/** Name yourself, pick a fighter, take a corner — and wait until it is yours. */
export async function takeCorner(page: Page, seat: "p1" | "p2", name: string, fighter: string): Promise<void> {
  const fighters = card(page, "Fighters");
  await expect(fighters).toBeVisible({ timeout: 60_000 });
  await fighters.getByLabel("your name").fill(name);
  await fighters.getByRole("radio", { name: fighter.toUpperCase(), exact: true }).click();
  await page.getByTestId(`sit-${seat}`).click({ timeout: 60_000 });
  await expect(page.getByTestId(`corner-${seat}`)).toContainText("you", { timeout: 60_000 });
}

export function status(page: Page): Locator {
  return page.getByTestId("status");
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A keyboard bot that fights. It reads where both fighters stand from the
 * canvas, closes the distance, and then mixes every move in the game: jabs,
 * kicks, uppercuts, sweeps, jump kicks, specials from range, and the odd block
 * or step back — which is what makes a fight worth watching.
 */
export async function brawl(page: Page, seat: "p1" | "p2", until: () => boolean): Promise<void> {
  const kb = page.keyboard;
  const canvas = page.locator("canvas.arena-canvas");
  const tap = async (key: string, hold = 70) => {
    await kb.down(key);
    await wait(hold);
    await kb.up(key);
  };
  while (!until()) {
    const pos = await canvas
      .evaluate((el: HTMLElement) => [Number(el.dataset["p1x"]), Number(el.dataset["p2x"])])
      .catch(() => [0, 0]);
    const me = seat === "p1" ? pos[0]! : pos[1]!;
    const them = seat === "p1" ? pos[1]! : pos[0]!;
    const toward = them >= me ? "KeyD" : "KeyA";
    const away = toward === "KeyD" ? "KeyA" : "KeyD";
    const dist = Math.abs(them - me);
    const r = Math.random();

    if (dist > 75) {
      if (dist > 160 && r < 0.18) {
        await tap("KeyI");
        await wait(450);
      } else if (r < 0.32) {
        await kb.down(toward);
        await tap("KeyW", 50);
        await wait(330);
        await tap("KeyK");
        await wait(380);
        await kb.up(toward);
      } else {
        await kb.down(toward);
        await wait(Math.min(600, 90 + dist * 2.2));
        await kb.up(toward);
      }
    } else if (r < 0.3) {
      await tap("KeyJ");
      await wait(240);
      if (Math.random() < 0.6) await tap("KeyJ");
    } else if (r < 0.5) {
      await tap("KeyK");
      await wait(300);
    } else if (r < 0.63) {
      await kb.down("KeyS");
      await wait(50);
      await tap("KeyJ");
      await wait(450);
      await kb.up("KeyS");
    } else if (r < 0.74) {
      await kb.down("KeyS");
      await wait(50);
      await tap("KeyK");
      await wait(420);
      await kb.up("KeyS");
    } else if (r < 0.84) {
      await tap("KeyL", 420);
    } else if (r < 0.92) {
      await kb.down(away);
      await wait(220);
      await kb.up(away);
    } else {
      await kb.down(toward);
      await tap("KeyW", 50);
      await wait(330);
      await tap("KeyK");
      await wait(380);
      await kb.up(toward);
    }
    await wait(40 + Math.random() * 90);
  }
}
