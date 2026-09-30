import { expect, type Locator, type Page } from "@playwright/test";
import { defaultLogin, type Actor, type AppDriver, type Feature } from "@calimero-apps/e2e-node/journey";
import { WorkspaceDriver } from "../fixtures/workspace";

const SYNC = 90_000;

function ws(actor: Actor): WorkspaceDriver {
  return new WorkspaceDriver(actor.page, { label: actor.name });
}

function firstFolder(actor: Actor): string {
  return `first-${actor.run}`;
}

async function waitForShell(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/app/, { timeout: 60_000 });
  await expect(page.getByTestId("workspace-switcher")).toBeVisible({ timeout: 60_000 });
}

async function eventually(page: Page, target: () => Locator, refresh: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + SYNC;
  for (;;) {
    const left = deadline - Date.now();
    try {
      await expect(target().first()).toBeVisible({ timeout: Math.max(1_000, Math.min(20_000, left)) });
      return;
    } catch (e) {
      if (Date.now() >= deadline) throw e;
    }
    await page.reload();
    await waitForShell(page);
    await refresh();
  }
}

async function openFolder(actor: Actor, name: string): Promise<void> {
  const w = ws(actor);
  await eventually(actor.page, () => w.tree.folderRow(name), async () => undefined);
  await w.tree.openFolder(name);
  await w.restrictedCard.joinIfPrompted(name, { timeout: SYNC });
}

async function openDoc(actor: Actor, title: string): Promise<void> {
  const w = ws(actor);
  await openFolder(actor, firstFolder(actor));
  await eventually(
    actor.page,
    () => w.docs.docRow(title),
    () => openFolder(actor, firstFolder(actor)),
  );
  await w.openDoc(title);
}

const docs: Record<string, string> = {};
let docCount = 0;

const createDoc: Feature = {
  name: "create a document in a shared folder",
  async do(actor) {
    const title = `doc-${actor.name}-${actor.run}-${++docCount}`;
    docs[actor.name] = title;
    await openFolder(actor, firstFolder(actor));
    await ws(actor).createDoc(title);
  },
  async seen(actor, by) {
    const title = docs[by.name];
    if (!title) throw new Error(`${by.name} has not created a document yet`);
    const w = ws(actor);
    await openFolder(actor, firstFolder(actor));
    await eventually(
      actor.page,
      () => w.docs.docRow(title),
      () => openFolder(actor, firstFolder(actor)),
    );
  },
};

const bodies: Record<string, { title: string; text: string }> = {};

const writeBody: Feature = {
  name: "write text into a document",
  async do(actor) {
    const title = docs[actor.name];
    if (!title) throw new Error(`${actor.name} has no document to write in`);
    const text = `body ${actor.name} ${actor.run} ${Date.now().toString(36)}`;
    bodies[actor.name] = { title, text };
    await openDoc(actor, title);
    const w = ws(actor);
    await w.editor.type(text);
    await w.editor.expectContent(text);
  },
  async seen(actor, by) {
    const b = bodies[by.name];
    if (!b) throw new Error(`${by.name} has not written anything yet`);
    await openDoc(actor, b.title);
    await ws(actor).editor.expectContent(b.text, { timeout: SYNC });
  },
};

const tags: Record<string, { title: string; tag: string }> = {};

const tagDoc: Feature = {
  name: "tag a document",
  async do(actor) {
    const title = docs[actor.name];
    if (!title) throw new Error(`${actor.name} has no document to tag`);
    const tag = `tag-${actor.name}-${actor.run}`;
    tags[actor.name] = { title, tag };
    await openDoc(actor, title);
    await ws(actor).tags.create(tag);
  },
  async seen(actor, by) {
    const t = tags[by.name];
    if (!t) throw new Error(`${by.name} has not tagged anything yet`);
    const w = ws(actor);
    await openDoc(actor, t.title);
    await eventually(
      actor.page,
      () => w.tags.chip(t.tag),
      () => openDoc(actor, t.title),
    );
  },
};

export const driver: AppDriver = {
  app: "mero-docs",

  async login(actor) {
    await defaultLogin(actor);
    await waitForShell(actor.page);
  },

  async createNamespace(actor, name) {
    await waitForShell(actor.page);
    await ws(actor).createNamespace(name);
  },

  async createSpace(actor, name) {
    const w = ws(actor);
    await w.createFolder({ name, visibility: "Open" });
    await w.tree.openFolder(name);
  },

  async openSpace(actor, name) {
    await openFolder(actor, name);
  },

  async invite(actor) {
    const w = ws(actor);
    await w.openSettings();
    const link = await w.settings.copyNamespaceInvite();
    await w.closeSettings();
    return link;
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    const url = new URL(link, "http://placeholder");
    await page.goto(`/${url.search}${url.hash}`);
    const accept = page.getByRole("button", { name: /^(Accept & join|Open workspace)$/ });
    await expect(accept).toBeVisible({ timeout: 60_000 });
    await accept.click();
    await expect(page).toHaveURL(/\/app/, { timeout: SYNC });
    await waitForShell(page);
    await ws(actor).dismissNameGateIfPresent();
  },

  async afterReload(actor) {
    await waitForShell(actor.page);
  },

  features: [createDoc, writeBody, tagDoc],
};
