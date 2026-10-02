import { expect, type Locator, type Page } from "@playwright/test";
import { defaultLogin, type Actor, type AppDriver, type Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

interface Cell {
  x: number;
  y: number;
}

const FLEET: ReadonlyArray<{ len: number; x: number; y: number }> = [
  { len: 5, x: 0, y: 0 },
  { len: 4, x: 0, y: 2 },
  { len: 3, x: 0, y: 4 },
  { len: 3, x: 0, y: 6 },
  { len: 2, x: 0, y: 8 },
];

const SHIP_CELLS: Cell[] = FLEET.flatMap((s) => Array.from({ length: s.len }, (_, i) => ({ x: s.x + i, y: s.y })));
const MISS_CELLS: Cell[] = [9, 7, 5, 3].flatMap((y) => Array.from({ length: 10 }, (_, i) => ({ x: 9 - i, y })));

const actors: Partial<Record<Actor["name"], Actor>> = {};
const lobbyUrl: Partial<Record<Actor["name"], string>> = {};
const fired: Partial<Record<Actor["name"], Cell>> = {};
const shotsBy: Record<Actor["name"], number> = { alice: 0, bob: 0 };
let lobbyName = "";
let matchId = "";
let matchUrl = "";

function other(actor: Actor): Actor["name"] {
  return actor.name === "alice" ? "bob" : "alice";
}

function inviteButton(page: Page): Locator {
  return page.getByRole("button", { name: "Invite player", exact: true });
}

function cellIn(grid: Locator, at: Cell): Locator {
  return grid.locator(`[data-x="${at.x}"][data-y="${at.y}"]`);
}

async function enterLobby(actor: Actor, name: string): Promise<void> {
  const page = actor.page;
  const row = page.getByTestId("lobby-row").filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: SYNC });
  const deadline = Date.now() + SYNC;
  for (;;) {
    const enter = row.getByRole("button", { name: "Enter" });
    if (await enter.isVisible().catch(() => false)) await enter.click().catch(() => undefined);
    const ready = await inviteButton(page)
      .waitFor({ state: "visible", timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    if (ready) break;
    if (Date.now() > deadline) throw new Error(`could not enter lobby ${name}`);
    const dismiss = page.getByRole("button", { name: "Dismiss" });
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  }
  await expect(page).toHaveURL(/\/lobby\?id=/, { timeout: 15_000 });
  const url = new URL(page.url());
  lobbyUrl[actor.name] = url.pathname + url.search;
}

async function ensureLobby(actor: Actor): Promise<void> {
  const page = actor.page;
  if (await inviteButton(page).isVisible().catch(() => false)) return;
  const url = lobbyUrl[actor.name];
  if (!url) throw new Error(`${actor.name} has never entered the lobby`);
  await page.goto(url);
  await expect(inviteButton(page)).toBeVisible({ timeout: SYNC });
}

async function waitForMatch(page: Page): Promise<void> {
  const placement = page.getByTestId("placement-grid");
  const board = page.getByTestId("own-board");
  const failed = page.getByText("Could not join match");
  await expect
    .poll(
      async () => {
        if ((await placement.isVisible().catch(() => false)) || (await board.isVisible().catch(() => false))) {
          return true;
        }
        if (await failed.isVisible().catch(() => false)) await page.reload();
        return false;
      },
      { timeout: SYNC, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);
}

async function ensureMatch(actor: Actor): Promise<void> {
  const page = actor.page;
  const placement = page.getByTestId("placement-grid");
  const board = page.getByTestId("own-board");
  if ((await placement.isVisible().catch(() => false)) || (await board.isVisible().catch(() => false))) return;
  if (!matchUrl) throw new Error("no match has been created yet");
  await page.goto(matchUrl);
  await waitForMatch(page);
}

async function fire(actor: Actor, at: Cell): Promise<void> {
  const page = actor.page;
  await ensureMatch(actor);
  const grid = page.getByTestId("shot-grid");
  await expect(grid.getByText("Your Turn")).toBeVisible({ timeout: SYNC });
  const cell = cellIn(grid, at);
  await expect(cell).toHaveClass(/cell-clickable/, { timeout: 30_000 });
  await cell.click();
  await page.getByRole("button", { name: "Fire", exact: true }).click();
  await expect(cell).toHaveClass(/cell-(hit|miss)/, { timeout: SYNC });
  fired[actor.name] = at;
}

function nextTarget(actor: Actor): Cell {
  const list = actor.name === "alice" ? SHIP_CELLS : MISS_CELLS;
  const at = list[shotsBy[actor.name]];
  if (!at) throw new Error(`${actor.name} has no cells left to shoot`);
  shotsBy[actor.name] += 1;
  return at;
}

const roster: Feature = {
  name: "open the lobby and see the other player",
  async do(actor: Actor) {
    await ensureLobby(actor);
    await expect(
      actor.page.getByTestId("lobby-member").getByRole("button", { name: "Copy", exact: true }).first(),
    ).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor: Actor) {
    await ensureLobby(actor);
    await expect(actor.page.getByTestId("challenge-player").first()).toBeVisible({ timeout: SYNC });
  },
};

const challenge: Feature = {
  name: "challenge the other player to a match",
  oneWay: true,
  async do(actor: Actor) {
    const page = actor.page;
    await ensureLobby(actor);
    const challengeRow = page.getByTestId("challenge-player").first();
    await expect(challengeRow).toBeVisible({ timeout: SYNC });
    await challengeRow.click();
    const form = page.locator("form", { has: page.getByPlaceholder("Opponent's player key") });
    await expect(page.getByPlaceholder("Opponent's player key")).not.toHaveValue("");
    await form.getByRole("button", { name: "Challenge", exact: true }).click();
    await page.waitForURL(/\/match\?match_id=/, { timeout: 60_000 });
    const url = new URL(page.url());
    matchId = url.searchParams.get("match_id") ?? "";
    matchUrl = url.pathname + url.search;
    await waitForMatch(page);
  },
  async seen(actor: Actor) {
    const page = actor.page;
    if (!matchId) throw new Error("no match was created");
    await ensureLobby(actor);
    const item = page.getByTestId("match-item").filter({ hasText: matchId });
    const open = item.getByRole("button", { name: "Open", exact: true });
    let polls = 0;
    await expect
      .poll(
        async () => {
          polls += 1;
          if (await open.isEnabled().catch(() => false)) return true;
          if (polls % 8 === 0) {
            await page.reload();
            await expect(inviteButton(page)).toBeVisible({ timeout: 30_000 });
          }
          return false;
        },
        { timeout: SYNC, intervals: [2_000, 3_000] },
      )
      .toBe(true);
    await open.click();
    await waitForMatch(page);
  },
};

const deploy: Feature = {
  name: "deploy a fleet",
  async do(actor: Actor) {
    const page = actor.page;
    await ensureMatch(actor);
    const grid = page.getByTestId("placement-grid");
    await expect(grid).toBeVisible({ timeout: SYNC });
    let selected: number | null = null;
    for (const ship of FLEET) {
      if (ship.len !== selected) {
        await page.locator(`[data-ship-len="${ship.len}"]`).click();
        selected = ship.len;
      }
      await cellIn(grid, ship).click();
    }
    const button = page.getByRole("button", { name: "Deploy Fleet", exact: true });
    await expect(button).toBeEnabled({ timeout: 10_000 });
    await button.click();
    await expect(page.getByTestId("own-board")).toBeVisible({ timeout: 60_000 });
    await expect(cellIn(page.getByTestId("own-board"), { x: 0, y: 0 })).toHaveClass(/cell-ship/);
  },
  async seen(actor: Actor, by: Actor) {
    await ensureMatch(actor);
    if (by.name === "bob") {
      await expect(actor.page.getByTestId("shot-grid").getByText("Your Turn")).toBeVisible({ timeout: SYNC });
    } else {
      await expect(actor.page.getByTestId("placement-grid")).toBeVisible({ timeout: SYNC });
    }
  },
};

const shoot: Feature = {
  name: "fire a shot",
  async do(actor: Actor) {
    await fire(actor, nextTarget(actor));
  },
  async seen(actor: Actor, by: Actor) {
    const at = fired[by.name];
    if (!at) throw new Error(`${by.name} has not fired yet`);
    await ensureMatch(actor);
    await expect(cellIn(actor.page.getByTestId("own-board"), at)).toHaveClass(/cell-(hit|miss)/, {
      timeout: SYNC,
    });
  },
};

const sinkFleet: Feature = {
  name: "sink the whole fleet and win (result recorded in the lobby)",
  oneWay: true,
  async do(actor: Actor) {
    const opponent = actors[other(actor)];
    if (!opponent) throw new Error("the opponent's page is not known");
    while (shotsBy[actor.name] < SHIP_CELLS.length) {
      await fire(actor, nextTarget(actor));
      if (shotsBy[actor.name] < SHIP_CELLS.length) await fire(opponent, nextTarget(opponent));
    }
    await expect(actor.page.getByText("You won this match.")).toBeVisible({ timeout: SYNC });
    await expect(actor.page.getByText("Victory", { exact: true })).toBeVisible();
  },
  async seen(actor: Actor) {
    const page = actor.page;
    await expect(page.getByText("Match over.", { exact: true })).toBeVisible({ timeout: SYNC });
    await expect(page.getByText("Defeat", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to Lobby", exact: true }).click();
    await expect(inviteButton(page)).toBeVisible({ timeout: SYNC });
    await page.getByRole("tab", { name: /History/ }).click();
    await expect(page.getByText("You lost", { exact: true }).first()).toBeVisible({ timeout: SYNC });
  },
};

export const driver: AppDriver = {
  app: "battleships",

  async login(actor) {
    actors[actor.name] = actor;
    await defaultLogin(actor);
    await expect(actor.page.getByPlaceholder("Lobby name")).toBeVisible({ timeout: 60_000 });
  },

  async createNamespace(actor, name) {
    const page = actor.page;
    lobbyName = name;
    const input = page.getByPlaceholder("Lobby name");
    await expect(input).toBeVisible({ timeout: 60_000 });
    await input.fill(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await enterLobby(actor, name);
  },

  async invite(actor) {
    const page = actor.page;
    await ensureLobby(actor);
    await inviteButton(page).click();
    const link = page.getByTestId("invite-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    return (await link.innerText()).trim();
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    await expect(page.getByPlaceholder("Lobby name")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: "Join via invitation" }).click();
    const input = page.getByPlaceholder("Paste invitation link");
    await input.fill(link);
    const row = page.getByTestId("lobby-row").filter({ hasText: lobbyName });
    const deadline = Date.now() + SYNC;
    for (;;) {
      const join = page.getByRole("button", { name: "Join", exact: true });
      if (await join.isEnabled().catch(() => false)) await join.click();
      const listed = await row
        .waitFor({ state: "visible", timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      if (listed) break;
      if (Date.now() > deadline) throw new Error("the lobby never appeared after joining");
      if (!(await input.inputValue().catch(() => ""))) await input.fill(link);
    }
    await enterLobby(actor, lobbyName);
  },

  async afterReload(actor) {
    const page = actor.page;
    await expect(page.getByRole("button", { name: "Logout" })).toBeVisible({ timeout: 60_000 });
    await ensureLobby(actor);
  },

  features: [roster, challenge, deploy, shoot, sinkFleet],
};
