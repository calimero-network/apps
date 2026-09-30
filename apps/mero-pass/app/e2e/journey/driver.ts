import { expect, type Locator, type Page } from "@playwright/test";
import { defaultLogin, type Actor, type AppDriver, type Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

const actors: Partial<Record<Actor["name"], Actor>> = {};
const inVault: Partial<Record<Actor["name"], string>> = {};
let teamName = "";

function firstVault(actor: Actor): string {
  return `first-${actor.run}`;
}

function secretRow(page: Page, name: string): Locator {
  return page.getByTestId("secret-row").filter({ hasText: name });
}

async function until(
  page: Page,
  check: () => Promise<boolean>,
  refresh: () => Promise<void>,
  message: string,
  timeout = SYNC,
): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const settle = Date.now() + Math.min(15_000, Math.max(1_000, deadline - Date.now()));
    while (Date.now() < settle) {
      if (await check().catch(() => false)) return;
      await page.waitForTimeout(1_000);
    }
    if (Date.now() >= deadline) throw new Error(`timed out: ${message}`);
    await page.reload();
    await refresh();
  }
}

async function unlockIfLocked(page: Page): Promise<void> {
  const unlock = page.getByTestId("unlock");
  if ((await unlock.count()) > 0 && (await unlock.isEnabled().catch(() => false))) {
    await unlock.click().catch(() => undefined);
  }
}

async function vaultReady(page: Page): Promise<boolean> {
  await unlockIfLocked(page);
  if ((await page.getByTestId("lock-gate").count()) > 0) return false;
  for (const id of ["opening", "waiting-for-admission", "waiting-for-approval", "waiting-for-key", "no-identity"]) {
    if ((await page.getByTestId(id).count()) > 0) return false;
  }
  const add = page.getByTestId("secret-add");
  return (await add.count()) > 0 && (await add.isEnabled());
}

async function waitForTeams(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: "Your vaults" })).toBeVisible({ timeout: 60_000 });
}

async function approvePendingDevices(page: Page): Promise<void> {
  const approve = page.getByTestId("approve-device");
  while ((await approve.count()) > 0) {
    await approve.first().click();
    await page.waitForTimeout(1_000);
  }
}

async function poke(name: string): Promise<void> {
  const alice = actors.alice;
  if (!alice) return;
  if (inVault.alice === name && /\/vault\//.test(alice.page.url())) {
    await alice.page.reload();
    await ensureReady(alice, name);
  } else {
    await openVault(alice, name);
  }
  await approvePendingDevices(alice.page);
}

async function ensureReady(actor: Actor, name: string): Promise<void> {
  const page = actor.page;
  const deadline = Date.now() + SYNC;
  let poked = 0;
  for (;;) {
    if (await vaultReady(page).catch(() => false)) return;
    if (Date.now() >= deadline) throw new Error(`${actor.name}: vault ${name} never became ready`);
    const retry = page.getByTestId("error").getByRole("button", { name: "Try again" });
    if ((await retry.count()) > 0) await retry.click().catch(() => undefined);
    if (actor.name !== "alice" && Date.now() - poked > 20_000) {
      const waiting =
        (await page.getByTestId("waiting-for-admission").count()) +
        (await page.getByTestId("waiting-for-key").count()) +
        (await page.getByTestId("waiting-for-approval").count());
      if (waiting > 0) {
        poked = Date.now();
        await poke(name);
      }
    }
    await page.waitForTimeout(2_000);
  }
}

async function openTeam(page: Page): Promise<void> {
  await page.goto("/teams");
  await waitForTeams(page);
  const cards = page.getByTestId("team-card");
  const named = cards.filter({ hasText: teamName });
  await until(
    page,
    async () => (await named.count()) > 0 || (await cards.count()) === 1,
    () => waitForTeams(page),
    `team ${teamName} is listed`,
  );
  await ((await named.count()) > 0 ? named : cards).first().click();
  await expect(page.getByTestId("team-heading")).toBeVisible({ timeout: 30_000 });
}

async function openVault(actor: Actor, name: string): Promise<void> {
  const page = actor.page;
  if (inVault[actor.name] === name && /\/vault\//.test(page.url())) {
    await ensureReady(actor, name);
    return;
  }
  await openTeam(page);
  const card = page.getByTestId("vault-card").filter({ hasText: name });
  await until(
    page,
    async () => (await card.count()) > 0 && (await card.first().isEnabled()),
    async () => {
      await expect(page.getByTestId("team-heading")).toBeVisible({ timeout: 30_000 });
    },
    `vault ${name} is listed`,
  );
  await card.first().click();
  await expect(page).toHaveURL(/\/vault\/[^/]+/, { timeout: 60_000 });
  inVault[actor.name] = name;
  await ensureReady(actor, name);
}

async function selectSecret(page: Page, name: string): Promise<Locator> {
  await secretRow(page, name).first().click();
  const detail = page.getByTestId("item-detail");
  await expect(detail.getByTestId("item-name")).toHaveText(name, { timeout: 15_000 });
  return detail;
}

async function readable(page: Page, name: string): Promise<boolean> {
  const row = secretRow(page, name);
  if ((await row.count()) === 0) return false;
  return !(await row.first().innerText()).includes("Not readable on this device");
}

function other(actor: Actor): Actor["name"] {
  return actor.name === "alice" ? "bob" : "alice";
}

const logins: Record<string, { name: string; username: string }> = {};
let loginCount = 0;

const addLogin: Feature = {
  name: "add a login to a shared vault",
  async do(actor) {
    const page = actor.page;
    const name = `login-${actor.name}-${actor.run}-${++loginCount}`;
    const username = `user-${actor.name}-${loginCount}`;
    logins[actor.name] = { name, username };
    await openVault(actor, firstVault(actor));
    await page.getByTestId("secret-add").click();
    const form = page.getByTestId("secret-form");
    await expect(form).toBeVisible({ timeout: 15_000 });
    await form.getByTestId("sf-name").fill(name);
    await form.getByTestId("sf-username").fill(username);
    await form.getByTestId("sf-password").fill(`pw-${Date.now().toString(36)}`);
    await form.getByTestId("sf-save").click();
    await expect(form).toBeHidden({ timeout: 30_000 });
    await expect(secretRow(page, name)).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor, by) {
    const login = logins[by.name];
    if (!login) throw new Error(`${by.name} has not added a login yet`);
    const page = actor.page;
    await openVault(actor, firstVault(actor));
    await until(
      page,
      () => readable(page, login.name),
      () => ensureReady(actor, firstVault(actor)),
      `login ${login.name} is readable`,
    );
    const detail = await selectSecret(page, login.name);
    await expect(detail).toContainText(login.username);
  },
};

const edits: Record<string, { name: string; password: string }> = {};

const editPassword: Feature = {
  name: "change the password on the other person's login",
  async do(actor) {
    const target = logins[other(actor)] ?? logins[actor.name];
    if (!target) throw new Error("no login to edit");
    const page = actor.page;
    const password = `pw-${actor.name}-${Date.now().toString(36)}`;
    edits[actor.name] = { name: target.name, password };
    await openVault(actor, firstVault(actor));
    await until(
      page,
      () => readable(page, target.name),
      () => ensureReady(actor, firstVault(actor)),
      `login ${target.name} is readable`,
    );
    await selectSecret(page, target.name);
    await page.getByTestId("secret-edit").click();
    const form = page.getByTestId("secret-form");
    await expect(form).toBeVisible({ timeout: 15_000 });
    await form.getByTestId("sf-password").fill(password);
    await form.getByTestId("sf-save").click();
    await expect(form).toBeHidden({ timeout: 30_000 });
    const detail = await selectSecret(page, target.name);
    await detail.getByRole("button", { name: "Reveal Password" }).click();
    await expect(detail).toContainText(password, { timeout: 15_000 });
  },
  async seen(actor, by) {
    const edit = edits[by.name];
    if (!edit) throw new Error(`${by.name} has not edited anything yet`);
    const page = actor.page;
    await openVault(actor, firstVault(actor));
    await until(
      page,
      async () => {
        if (!(await readable(page, edit.name))) return false;
        const detail = await selectSecret(page, edit.name);
        const reveal = detail.getByRole("button", { name: "Reveal Password" });
        if ((await reveal.count()) > 0) await reveal.click();
        return (await detail.innerText()).includes(edit.password);
      },
      () => ensureReady(actor, firstVault(actor)),
      `the new password on ${edit.name}`,
    );
  },
};

const trashed: Record<string, string> = {};

const trashLogin: Feature = {
  name: "move the other person's login to the trash",
  oneWay: true,
  async do(actor) {
    const target = logins[other(actor)];
    if (!target) throw new Error("no login to trash");
    const page = actor.page;
    trashed[actor.name] = target.name;
    await openVault(actor, firstVault(actor));
    const detail = await selectSecret(page, target.name);
    await detail.getByTestId("secret-trash").click();
    await expect(secretRow(page, target.name)).toHaveCount(0, { timeout: 30_000 });
  },
  async seen(actor, by) {
    const name = trashed[by.name];
    if (!name) throw new Error(`${by.name} has not trashed anything`);
    const page = actor.page;
    await openVault(actor, firstVault(actor));
    await until(
      page,
      async () => (await vaultReady(page)) && (await secretRow(page, name).count()) === 0,
      () => ensureReady(actor, firstVault(actor)),
      `login ${name} leaves the list`,
    );
  },
};

export const driver: AppDriver = {
  app: "mero-pass",

  async login(actor) {
    actors[actor.name] = actor;
    await defaultLogin(actor);
    await waitForTeams(actor.page);
  },

  async createNamespace(actor, name) {
    const page = actor.page;
    teamName = name;
    await waitForTeams(page);
    await page.getByTestId("team-name").fill(name);
    await expect(page.getByTestId("team-create")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("team-create").click();
    await expect(page).toHaveURL(/\/teams\/[^/]+/, { timeout: 60_000 });
    await expect(page.getByTestId("team-heading")).toHaveText(name, { timeout: 30_000 });
  },

  async createSpace(actor, name) {
    const page = actor.page;
    await openTeam(page);
    await expect(page.getByTestId("vault-name")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("vault-name").fill(name);
    await page.getByTestId("vault-create").click();
    await expect(page.getByTestId("vault-card").filter({ hasText: name })).toBeVisible({ timeout: 60_000 });
    await openVault(actor, name);
  },

  async openSpace(actor, name) {
    await openVault(actor, name);
  },

  async invite(actor) {
    const page = actor.page;
    await openTeam(page);
    await page.getByTestId("invite-team").click();
    const link = page.getByTestId("invite-modal").getByTestId("invite-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    const value = ((await link.getAttribute("title")) ?? (await link.innerText())).trim();
    await page.getByTestId("invite-modal-close").click();
    await openVault(actor, firstVault(actor));
    return value;
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    await waitForTeams(page);
    await page.getByTestId("join-code").fill(link);
    await page.getByTestId("join-submit").click();
    const landed = page.waitForURL(/\/(vault|teams)\/[^/]+/, { timeout: SYNC });
    const failed = page
      .getByTestId("join-error")
      .waitFor({ state: "visible", timeout: SYNC })
      .then(async () => {
        throw new Error(`join refused: ${await page.getByTestId("join-error").innerText()}`);
      });
    landed.catch(() => undefined);
    failed.catch(() => undefined);
    await Promise.race([landed, failed]);
    if (/\/vault\//.test(page.url())) {
      inVault[actor.name] = firstVault(actor);
      await ensureReady(actor, firstVault(actor));
    }
  },

  async afterReload(actor) {
    const page = actor.page;
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    const name = inVault[actor.name];
    if (name && /\/vault\//.test(page.url())) await ensureReady(actor, name);
  },

  features: [addLogin, editPassword, trashLogin],
};
