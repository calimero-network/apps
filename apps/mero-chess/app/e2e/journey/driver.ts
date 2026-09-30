import { expect, type Locator, type Page } from "@playwright/test";
import type { Actor, AppDriver, Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

const MOVES: ReadonlyArray<{ from: string; to: string; san: string }> = [
  { from: "e2", to: "e4", san: "e4" },
  { from: "e7", to: "e5", san: "e5" },
  { from: "g1", to: "f3", san: "Nf3" },
  { from: "b8", to: "c6", san: "Nc6" },
  { from: "f1", to: "c4", san: "Bc4" },
  { from: "g8", to: "f6", san: "Nf6" },
  { from: "d2", to: "d3", san: "d3" },
  { from: "f8", to: "c5", san: "Bc5" },
  { from: "b1", to: "c3", san: "Nc3" },
  { from: "d7", to: "d6", san: "d6" },
];

type Colour = "white" | "black";

type Done =
  | { kind: "seat"; colour: Colour; name: string }
  | { kind: "move"; ply: number; san: string };

const done: Record<string, Done> = {};
let ply = 0;

function colourOf(actor: Actor): Colour {
  return actor.name === "alice" ? "white" : "black";
}

function displayName(actor: Actor): string {
  return `${actor.name}-${actor.run}`.slice(0, 32);
}

function card(page: Page, heading: string): Locator {
  return page.locator(".card", { has: page.getByRole("heading", { name: heading, exact: true }) });
}

function plyCell(page: Page, n: number): Locator {
  return page
    .getByTestId("scoresheet")
    .locator("li")
    .nth(Math.floor(n / 2))
    .locator(".san")
    .nth(n % 2);
}

async function waitForBoard(page: Page): Promise<void> {
  await expect(page.getByRole("grid", { name: "chess board" })).toBeVisible({ timeout: 60_000 });
}

async function isSeated(page: Page, colour: Colour): Promise<boolean> {
  return (await page.getByTestId(`seat-${colour}`).innerText()).includes("— you");
}

async function ensureSeated(actor: Actor): Promise<boolean> {
  const page = actor.page;
  const colour = colourOf(actor);
  await waitForBoard(page);
  if (await isSeated(page, colour)) return false;
  const name = page.getByLabel("your name", { exact: true });
  if (await name.isVisible()) await name.fill(displayName(actor));
  await page.getByTestId(`sit-${colour}`).click({ timeout: SYNC });
  await expect(page.getByTestId(`seat-${colour}`)).toContainText("— you", { timeout: 30_000 });
  done[actor.name] = { kind: "seat", colour, name: displayName(actor) };
  return true;
}

async function playNext(actor: Actor): Promise<void> {
  const page = actor.page;
  const next = MOVES[ply];
  if (!next) throw new Error(`no scripted move left at ply ${ply}`);
  const turn: Colour = ply % 2 === 0 ? "white" : "black";
  if (turn !== colourOf(actor)) throw new Error(`ply ${ply} is ${turn}'s move, not ${actor.name}'s`);
  if (ply > 0) await expect(plyCell(page, ply - 1)).toHaveText(MOVES[ply - 1]?.san ?? "", { timeout: SYNC });
  await page.getByTestId(`square-${next.from}`).click({ timeout: SYNC });
  await page.getByTestId(`square-${next.to}`).click({ timeout: 15_000 });
  await expect(plyCell(page, ply)).toHaveText(next.san, { timeout: 30_000 });
  done[actor.name] = { kind: "move", ply, san: next.san };
  ply += 1;
}

async function bothSeated(page: Page): Promise<boolean> {
  const white = await page.getByTestId("seat-white").innerText();
  const black = await page.getByTestId("seat-black").innerText();
  return !white.includes("empty") && !black.includes("empty");
}

async function seeDone(actor: Actor, by: Actor): Promise<void> {
  const d = done[by.name];
  if (!d) throw new Error(`${by.name} has not done anything yet`);
  const page = actor.page;
  await waitForBoard(page);
  if (d.kind === "seat") {
    await expect(page.getByTestId(`seat-${d.colour}`)).toContainText(d.name, { timeout: SYNC });
  } else {
    await expect(plyCell(page, d.ply)).toHaveText(d.san, { timeout: SYNC });
  }
}

const seatOrMove: Feature = {
  name: "take my seat, or play my next move when it is my turn",
  async do(actor: Actor) {
    const sat = await ensureSeated(actor);
    if (sat) return;
    const turn: Colour = ply % 2 === 0 ? "white" : "black";
    if (turn !== colourOf(actor) || !(await bothSeated(actor.page))) {
      throw new Error(`${actor.name} is seated and it is not ${actor.name}'s move (ply ${ply})`);
    }
    await playNext(actor);
  },
  seen: seeDone,
};

function moveFeature(name: string, oneWay = false): Feature {
  return {
    name,
    oneWay,
    async do(actor: Actor) {
      await ensureSeated(actor);
      await playNext(actor);
    },
    seen: seeDone,
  };
}

const drawOffer: Feature = {
  name: "offer a draw, and the opponent declines it",
  async do(actor: Actor) {
    const page = actor.page;
    const offer = page.getByTestId("draw-offer");
    if (await offer.isVisible()) {
      await offer.getByRole("button", { name: "Decline", exact: true }).click();
      await expect(offer).toBeHidden({ timeout: 30_000 });
      return;
    }
    await page.getByRole("button", { name: "Offer draw", exact: true }).click();
    await expect(page.getByTestId("offer-pending")).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor: Actor, by: Actor) {
    const page = actor.page;
    if (by.name === "alice") {
      await expect(page.getByTestId("draw-offer")).toBeVisible({ timeout: SYNC });
    } else {
      await expect(page.getByTestId("offer-pending")).toBeHidden({ timeout: SYNC });
      await expect(page.getByRole("button", { name: "Offer draw", exact: true })).toBeVisible({
        timeout: SYNC,
      });
    }
  },
};

export const driver: AppDriver = {
  app: "mero-chess",

  async open(actor) {
    await actor.page.goto("/play");
  },

  async createNamespace(actor) {
    const page = actor.page;
    await expect(page.getByRole("heading", { name: "Choose a table", exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "New table", exact: true }).click({ timeout: 30_000 });
    await waitForBoard(page);
  },

  async invite(actor) {
    const inviteCard = card(actor.page, "Invite an opponent");
    await inviteCard.getByRole("button", { name: "Create invite link", exact: true }).click({ timeout: 30_000 });
    const link = inviteCard.locator("code.invite-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    return (await link.getAttribute("title")) ?? (await link.innerText());
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    const join = card(page, "Join with an invitation");
    await expect(join).toBeVisible({ timeout: 60_000 });
    await join.getByLabel("invitation", { exact: true }).fill(link);
    await join.getByRole("button", { name: "Join", exact: true }).first().click();
    await expect(page.getByRole("grid", { name: "chess board" })).toBeVisible({ timeout: 120_000 });
  },

  async afterReload(actor) {
    await waitForBoard(actor.page);
  },

  features: [
    seatOrMove,
    moveFeature("play the next move for my colour"),
    drawOffer,
    moveFeature("keep playing: the next move for my colour"),
    moveFeature("white plays on, black replies after the restart", true),
  ],
};
