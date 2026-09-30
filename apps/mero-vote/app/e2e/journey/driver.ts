import { expect, type Locator, type Page } from "@playwright/test";
import type { Actor, AppDriver, Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;
const OPTIONS = ["Yes", "No"] as const;

const names: Record<string, string> = {};
const ballots: Record<string, string> = {};
let renames = 0;
let pollTitle = "";

function card(page: Page, heading: string | RegExp): Locator {
  return page.locator(".card", {
    has: page.getByRole("heading", { name: heading, exact: typeof heading === "string" }),
  });
}

function btn(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true });
}

async function waitForPanel(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Polls", exact: true })).toBeVisible({ timeout: 60_000 });
}

async function toList(page: Page): Promise<void> {
  const back = btn(page, "← All polls");
  if (await back.isVisible()) await back.click();
  await waitForPanel(page);
}

async function refreshList(page: Page): Promise<void> {
  await toList(page);
  await card(page, "Polls").getByRole("button", { name: "Refresh", exact: true }).click();
}

function pollRow(page: Page, title: string): Locator {
  return page.getByRole("button", { name: new RegExp(title) });
}

async function openPoll(page: Page, title: string): Promise<void> {
  const heading = page.getByRole("heading", { name: title, exact: true });
  if (await heading.isVisible()) return;
  await toList(page);
  await pollRow(page, title).click({ timeout: 30_000 });
  await expect(heading).toBeVisible({ timeout: 30_000 });
}

async function eventually(page: Page, title: string | null, check: () => Promise<boolean>): Promise<void> {
  await expect
    .poll(
      async () => {
        await refreshList(page);
        if (title) {
          if ((await pollRow(page, title).count()) === 0) return false;
          await openPoll(page, title);
        }
        return check();
      },
      { timeout: SYNC, intervals: [2_000, 3_000, 5_000] },
    )
    .toBe(true);
}

function title(): string {
  if (!pollTitle) throw new Error("no poll has been created yet");
  return pollTitle;
}

const setName: Feature = {
  name: "set my display name",
  async do(actor: Actor) {
    const page = actor.page;
    await toList(page);
    renames += 1;
    const name = `${actor.name}-${actor.run}-${renames}`;
    names[actor.name] = name;
    const you = card(page, "You");
    await you.getByLabel("Your name", { exact: true }).fill(name);
    await you.getByRole("button", { name: /^(Join roster|Rename)$/ }).click();
    await expect(you).toContainText(name, { timeout: 30_000 });
  },
  async seen(actor: Actor, by: Actor) {
    const name = names[by.name];
    if (!name) throw new Error(`${by.name} has not set a name yet`);
    const page = actor.page;
    await eventually(page, null, async () =>
      (await page.getByTestId("member").filter({ hasText: name }).count()) > 0,
    );
  },
};

const createPoll: Feature = {
  name: "create a poll, run the key ceremony and open voting",
  oneWay: true,
  async do(actor: Actor) {
    const page = actor.page;
    await toList(page);
    pollTitle = `Poll ${actor.run}`;
    await btn(page, "New poll").click();
    await page.getByPlaceholder("Where do we hold the offsite?").fill(pollTitle);
    await page.getByRole("textbox", { name: "Option 1", exact: true }).fill(OPTIONS[0]);
    await page.getByRole("textbox", { name: "Option 2", exact: true }).fill(OPTIONS[1]);
    await btn(page, "Create poll").click();
    await expect(page.getByRole("heading", { name: pollTitle, exact: true })).toBeVisible({ timeout: 30_000 });
    await btn(page, "Publish my transport key").click();
    await expect(page.getByText("Transport key published.")).toBeVisible({ timeout: 30_000 });
    await btn(page, "Deal my key shares").click({ timeout: 30_000 });
    await expect(page.getByText("Shares dealt.")).toBeVisible({ timeout: 30_000 });
    await btn(page, "Open voting").click({ timeout: 30_000 });
    await expect(page.getByText("Voting is open.")).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor: Actor) {
    const page = actor.page;
    const t = title();
    await eventually(page, null, async () => {
      const row = pollRow(page, t);
      return (await row.count()) > 0 && (await row.first().innerText()).includes("Voting");
    });
  },
};

const castBallot: Feature = {
  name: "cast an encrypted ballot",
  async do(actor: Actor) {
    const page = actor.page;
    const t = title();
    const option = actor.name === "alice" ? OPTIONS[0] : OPTIONS[1];
    ballots[actor.name] = option;
    await eventually(page, t, async () => page.getByRole("radio", { name: option, exact: true }).isVisible());
    await page.getByRole("radio", { name: option, exact: true }).check();
    await page.getByRole("button", { name: /^(Encrypt & cast ballot|Replace my ballot)$/ }).click();
    await expect(page.getByText("Ballot cast.")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Your receipt/)).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor: Actor, by: Actor) {
    const name = names[by.name];
    if (!name) throw new Error(`${by.name} has no display name`);
    const page = actor.page;
    await eventually(page, title(), async () =>
      (await page.getByTestId("voter").filter({ hasText: name }).count()) > 0,
    );
  },
};

async function resultCount(page: Page, option: string): Promise<string | null> {
  const row = page.getByTestId("result-row").filter({ hasText: option });
  if ((await row.count()) === 0) return null;
  return (await row.first().getByTestId("result-count").innerText()).trim();
}

async function tallyShown(page: Page): Promise<boolean> {
  for (const option of OPTIONS) {
    const expected = Object.values(ballots).filter((b) => b === option).length;
    if ((await resultCount(page, option)) !== String(expected)) return false;
  }
  return true;
}

const tally: Feature = {
  name: "close the poll, seal the count and decrypt the tally",
  oneWay: true,
  async do(actor: Actor) {
    const page = actor.page;
    await openPoll(page, title());
    await btn(page, "Close poll").click({ timeout: 30_000 });
    await expect(page.getByText("Poll closed to new ballots.")).toBeVisible({ timeout: 30_000 });
    await btn(page, "Seal the count").click({ timeout: 30_000 });
    await expect(page.getByText("Count sealed.")).toBeVisible({ timeout: 30_000 });
    await btn(page, "Publish my decryption share").click({ timeout: 30_000 });
    await expect(page.getByText("Decryption share published.")).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => tallyShown(page), { timeout: 30_000 }).toBe(true);
  },
  async seen(actor: Actor) {
    const page = actor.page;
    await eventually(page, title(), () => tallyShown(page));
  },
};

export const driver: AppDriver = {
  app: "mero-vote",

  async createNamespace(actor) {
    const page = actor.page;
    await expect(page.getByRole("heading", { name: "Choose a context", exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await btn(page, "Create namespace + context").click({ timeout: 30_000 });
    await waitForPanel(page);
  },

  async invite(actor) {
    const inviteCard = card(actor.page, "Invite someone");
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
    await expect(page.getByRole("heading", { name: "Polls", exact: true })).toBeVisible({ timeout: 120_000 });
  },

  async afterReload(actor) {
    await waitForPanel(actor.page);
  },

  features: [setName, createPoll, castBallot, tally],
};
