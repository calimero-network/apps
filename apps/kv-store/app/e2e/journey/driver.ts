import { expect, type Locator, type Page } from "@playwright/test";
import type {
  Actor,
  AppDriver,
  Feature,
} from "@calimero-apps/e2e-node/journey";

const SYNC_TIMEOUT = 90_000;

function card(page: Page, heading: string): Locator {
  return page.locator(".card", {
    has: page.getByRole("heading", { name: heading, exact: true }),
  });
}

function entryRow(page: Page, key: string): Locator {
  return card(page, "Entries").locator("tr", {
    has: page.locator("td.mono", { hasText: new RegExp(`^${key}$`) }),
  });
}

async function waitForPanel(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Write", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
}

async function setEntry(page: Page, key: string, value: string): Promise<void> {
  const write = card(page, "Write");
  await write.getByLabel("key", { exact: true }).fill(key);
  await write.getByLabel("value", { exact: true }).fill(value);
  await write.getByRole("button", { name: "set", exact: true }).click();
  await expect(entryRow(page, key)).toContainText(value, { timeout: 30_000 });
}

async function seeEntry(
  page: Page,
  key: string,
  value: string | null,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await card(page, "Entries")
          .getByRole("button", { name: "Refresh", exact: true })
          .click();
        const row = entryRow(page, key);
        if (value === null) return (await row.count()) === 0;
        return (
          (await row.count()) > 0 &&
          (await row.first().innerText()).includes(value)
        );
      },
      { timeout: SYNC_TIMEOUT, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);
}

/** The namespace `createNamespace` made, matched by the id its note shows. */
let created: RegExp | null = null;

type Entry = { key: string; value: string };
const written: Record<string, Entry> = {};
const overwritten: Record<string, Entry> = {};

const setKey: Feature = {
  name: "set a key",
  async do(actor: Actor) {
    const key = `${actor.name}-${actor.run}`;
    const value = `v-${Date.now().toString(36)}`;
    written[actor.name] = { key, value };
    await setEntry(actor.page, key, value);
  },
  async seen(actor: Actor, by: Actor) {
    const w = written[by.name];
    if (!w) throw new Error(`${by.name} has not written anything yet`);
    await seeEntry(actor.page, w.key, w.value);
  },
};

const overwriteKey: Feature = {
  name: "overwrite a shared key",
  async do(actor: Actor) {
    const key = `shared-${actor.run}`;
    const value = `over-${actor.name}-${Date.now().toString(36)}`;
    overwritten[actor.name] = { key, value };
    await setEntry(actor.page, key, value);
  },
  async seen(actor: Actor, by: Actor) {
    const w = overwritten[by.name];
    if (!w) throw new Error(`${by.name} has not written anything yet`);
    await seeEntry(actor.page, w.key, w.value);
  },
};

const removeKey: Feature = {
  name: "remove a key",
  oneWay: true,
  async do(actor: Actor) {
    const w = overwritten[actor.name];
    if (!w) throw new Error("nothing to remove");
    const remove = card(actor.page, "Remove");
    await remove.getByLabel("remove key", { exact: true }).fill(w.key);
    await remove.getByRole("button", { name: "remove", exact: true }).click();
    await seeEntry(actor.page, w.key, null);
  },
  async seen(actor: Actor, by: Actor) {
    const w = overwritten[by.name];
    if (!w) throw new Error(`${by.name} has not removed anything`);
    await seeEntry(actor.page, w.key, null);
  },
};

export const driver: AppDriver = {
  app: "kv-store",

  async createNamespace(actor) {
    const page = actor.page;
    await expect(
      page.getByRole("heading", { name: "Choose a context" }),
    ).toBeVisible({ timeout: 60_000 });
    await page
      .getByRole("button", { name: "Create namespace", exact: true })
      .click();
    const note = page.getByText(/Namespace .* created/);
    await expect(note).toBeVisible({
      timeout: 30_000,
    });
    // The note shortens the id to `head…tail`. Kept so the context goes into
    // THIS namespace: a node reused by a later test lists earlier ones too.
    const id = /Namespace (\w+)…(\w+) created/.exec(await note.innerText());
    if (!id) throw new Error(`unexpected note: ${await note.innerText()}`);
    created = new RegExp(`^${id[1]}\\w*${id[2]}$`);
  },

  async createSpace(actor) {
    const page = actor.page;
    if (!created) throw new Error("no namespace has been created yet");
    const row = card(page, "Namespaces").locator("tr", {
      has: page.locator("td.mono", { hasText: created }),
    });
    await row.getByRole("button", { name: "Add context" }).click();
    await waitForPanel(page);
  },

  async invite(actor) {
    const page = actor.page;
    const inviteCard = card(page, "Invite someone");
    await inviteCard
      .getByRole("button", { name: "Create invite link" })
      .click();
    const link = inviteCard.locator("code.invite-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    return (await link.getAttribute("title")) ?? (await link.innerText());
  },

  async joined(actor) {
    // The dialog was accepted and has closed by itself, which it does only
    // once the panel read the joined context's entries. The join opens that
    // context in place, so the panel is what is on screen now.
    await waitForPanel(actor.page);
  },

  async afterReload(actor) {
    await waitForPanel(actor.page);
  },

  features: [setKey, overwriteKey, removeKey],
};
