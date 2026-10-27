import { expect, type Locator, type Page } from "@playwright/test";
import type { AppDriver, Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

/** The studio, once the scene has loaded and the viewport has drawn its first frame. */
async function waitForStudio(page: Page): Promise<void> {
  await expect(page.getByTestId("studio")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".save-state")).toHaveText("Saved to your node", {
    timeout: 60_000,
  });
  // Software GL compiles the first frame's shaders while blocking input.
  await expect(page.getByTestId("viewport")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 60_000 },
  );
}

function sharePanel(page: Page): Locator {
  return page.getByRole("dialog", { name: "Share" });
}

async function openShare(page: Page): Promise<Locator> {
  const panel = sharePanel(page);
  if (!(await panel.isVisible())) await page.getByTestId("share").click();
  await expect(panel).toBeVisible();
  return panel;
}

async function closeShare(page: Page): Promise<void> {
  const panel = sharePanel(page);
  if (await panel.isVisible())
    await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toBeHidden();
}

function memberRow(panel: Locator, name: string): Locator {
  return panel.locator(".member-list li", {
    has: panel.page().locator(".member-name", { hasText: name }),
  });
}

/** Each actor's current display name; every rename is a new one, so a stale read cannot pass. */
const names: Record<string, string> = {};
let renames = 0;

/**
 * Naming yourself is the one write every member may make — the contract's `join` —
 * so it is the feature both sides can do from the moment they are in.
 */
const rename: Feature = {
  name: "name yourself; the other side's members list shows it",
  async do(actor) {
    const page = actor.page;
    await waitForStudio(page);
    const name = `${actor.name}-${actor.run}-${++renames}`;
    names[actor.name] = name;
    const panel = await openShare(page);
    const field = panel.getByLabel("Your name");
    await field.fill(name);
    await field.press("Enter");
    await expect(memberRow(panel, name)).toContainText("(you)", {
      timeout: 30_000,
    });
  },
  async seen(viewer, by) {
    const name = names[by.name];
    if (!name) throw new Error(`${by.name} has not named themselves yet`);
    await waitForStudio(viewer.page);
    const panel = await openShare(viewer.page);
    // The panel re-reads the members every 5s.
    await expect(memberRow(panel, name)).toBeVisible({ timeout: SYNC });
  },
};

/** The scene's admin lets bob edit. Only an admin can, so it goes one way. */
const grantEdit: Feature = {
  name: "the admin lets the invitee edit",
  oneWay: true,
  async do(actor) {
    const bob = names["bob"];
    if (!bob) throw new Error("bob has not named himself yet");
    const panel = await openShare(actor.page);
    const toggle = memberRow(panel, bob).getByRole("checkbox", {
      name: "Can edit",
    });
    await expect(toggle).toBeVisible({ timeout: SYNC });
    // Controlled by the members list: it flips once the grant has landed and
    // the list re-read, not on click, so `check()` would give up early.
    await toggle.click();
    await expect(toggle).toBeChecked({ timeout: 30_000 });
    await closeShare(actor.page);
  },
  async seen(viewer) {
    await closeShare(viewer.page);
    await expect(
      viewer.page.locator(".role-badge.viewer", { hasText: "View only" }),
    ).toHaveCount(0, {
      timeout: SYNC,
    });
    await expect(viewer.page.getByTestId("add-cube")).toBeEnabled({
      timeout: SYNC,
    });
  },
};

const objects: Record<string, string> = {};

/** Modelling itself: an object one side adds and names appears in the other's outliner. */
const addObject: Feature = {
  name: "add and name an object; the other side's outliner shows it",
  async do(actor) {
    const page = actor.page;
    await closeShare(page);
    const name = `${actor.name} cube ${actor.run}`;
    objects[actor.name] = name;
    await page.getByTestId("add-cube").click();
    const field = page.getByLabel("Object name");
    await expect(field).toHaveValue(/^Cube/);
    await field.fill(name);
    await field.press("Enter");
    await expect(
      page.getByTestId("outliner-row").filter({ hasText: name }),
    ).toHaveCount(1);
    await expect(page.locator(".save-state")).toHaveText("Saved to your node", {
      timeout: 30_000,
    });
  },
  async seen(viewer, by) {
    const name = objects[by.name];
    if (!name) throw new Error(`${by.name} has not added anything yet`);
    await closeShare(viewer.page);
    await expect(
      viewer.page.getByTestId("outliner-row").filter({ hasText: name }),
    ).toHaveCount(1, {
      timeout: SYNC,
    });
  },
};

export const driver: AppDriver = {
  app: "mero-models",

  // The studio route, not the landing page: it is where Connect sends you back to.
  async open(actor) {
    await actor.page.goto("studio");
  },

  async createNamespace(actor, name) {
    const page = actor.page;
    // Fresh per test: the desktop-link test runs after the full lifecycle in one worker.
    for (const key of Object.keys(names)) delete names[key];
    for (const key of Object.keys(objects)) delete objects[key];
    await expect(page.getByTestId("new-scene")).toBeEnabled({
      timeout: 60_000,
    });
    await page.getByLabel("Scene name").fill(name);
    await page.getByTestId("new-scene").click();
    await waitForStudio(page);
    await expect(page.getByTestId("scene-name")).toHaveText(name);
  },

  async invite(actor) {
    const panel = await openShare(actor.page);
    const card = panel.locator(".invite-card");
    await card
      .getByRole("button", { name: "Create invite link", exact: true })
      .click();
    const link = card.locator("code.invite-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    const href = (await link.getAttribute("title")) ?? (await link.innerText());
    await closeShare(actor.page);
    return href;
  },

  async joined(actor) {
    const page = actor.page;
    const landed = waitForStudio(page);
    const refused = page
      .getByTestId("invite-error")
      .waitFor({ state: "visible", timeout: SYNC })
      .then(async () => {
        throw new Error(
          `join refused: ${await page.getByTestId("invite-error").innerText()}`,
        );
      });
    landed.catch(() => undefined);
    refused.catch(() => undefined);
    await Promise.race([landed, refused]);
    // Joined as a viewer: the admin has not let this member edit yet.
    await expect(
      page.locator(".role-badge.viewer", { hasText: "View only" }),
    ).toBeVisible({ timeout: SYNC });
  },

  async afterReload(actor) {
    await waitForStudio(actor.page);
  },

  features: [rename, grantEdit, addObject],
};
