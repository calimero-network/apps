import { expect, type Page } from "@playwright/test";
import type { Actor, AppDriver, Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

let streamPath = "";
const rooms: Partial<Record<Actor["name"], string>> = {};

async function waitRooms(page: Page): Promise<void> {
  await expect(page.getByTestId("room-name-input")).toBeVisible({ timeout: SYNC });
}

async function gotoRooms(actor: Actor): Promise<void> {
  const page = actor.page;
  if (new URL(page.url()).pathname !== streamPath) {
    await closePeople(page);
    const back = page.getByTestId("back-to-rooms");
    if (await back.isVisible().catch(() => false)) await back.click();
    else await page.goto(streamPath);
  }
  await waitRooms(page);
}

async function waitCall(page: Page): Promise<void> {
  await expect(page.getByTestId("capture-toggle")).toBeVisible({ timeout: SYNC });
  await expect(page.locator('[data-testid="join-state"][data-joined="true"]')).toHaveCount(1, { timeout: SYNC });
  if ((await page.getByTestId("identity-btn").getAttribute("data-unset")) === "true") {
    await page.getByTestId("people-dialog").waitFor({ timeout: 5_000 }).catch(() => undefined);
    await closePeople(page);
  }
}

async function closePeople(page: Page): Promise<void> {
  const dialog = page.getByTestId("people-dialog");
  if (await dialog.isVisible().catch(() => false)) {
    await page.getByTestId("people-dialog-close").click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
}

async function openPeople(page: Page): Promise<void> {
  const dialog = page.getByTestId("people-dialog");
  if (!(await dialog.isVisible().catch(() => false))) await page.getByTestId("people-toggle").click();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
}

async function ensureCall(actor: Actor): Promise<void> {
  if (new URL(actor.page.url()).pathname === "/live") return;
  const room = rooms[actor.name];
  if (!room) throw new Error(`${actor.name} has not entered a room yet`);
  await enterRoom(actor, room);
}

async function enterRoom(actor: Actor, name: string): Promise<void> {
  const page = actor.page;
  await gotoRooms(actor);
  const row = page.getByTestId("room-row").filter({ hasText: name });
  const enter = row.getByTestId("enter-room");
  await expect
    .poll(
      async () => {
        if ((await row.count()) > 0 && (await enter.isEnabled())) return true;
        await page.getByTestId("refresh-rooms").click({ timeout: 5_000 }).catch(() => undefined);
        return false;
      },
      { timeout: SYNC, intervals: [2_000, 3_000, 5_000] },
    )
    .toBe(true);
  await enter.click();
  await page.waitForURL((u) => u.pathname === "/live", { timeout: SYNC });
  await waitCall(page);
  rooms[actor.name] = name;
}

const nicknames: Partial<Record<Actor["name"], string>> = {};

const setNickname: Feature = {
  name: "set a nickname the room sees",
  async do(actor) {
    const page = actor.page;
    await ensureCall(actor);
    const nickname = `${actor.name}-${Date.now().toString(36)}`;
    nicknames[actor.name] = nickname;
    await openPeople(page);
    await page.getByTestId("username-input").fill(nickname);
    await page.getByTestId("username-submit").click();
    await expect(page.getByTestId("nickname-saved")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="person-row"][data-self="true"]')).toContainText(nickname, {
      timeout: 30_000,
    });
    await closePeople(page);
  },
  async seen(actor, by) {
    const nickname = nicknames[by.name];
    if (!nickname) throw new Error(`${by.name} has not set a nickname yet`);
    const page = actor.page;
    await ensureCall(actor);
    await openPeople(page);
    await expect(page.getByTestId("person-row").filter({ hasText: nickname })).toBeVisible({ timeout: SYNC });
    await closePeople(page);
  },
};

const goLive: Feature = {
  name: "go live: camera frames reach the other node",
  async do(actor) {
    const page = actor.page;
    await ensureCall(actor);
    await closePeople(page);
    const toggle = page.getByTestId("capture-toggle");
    if ((await toggle.getAttribute("data-running")) !== "true") {
      await expect(toggle).toBeEnabled({ timeout: 30_000 });
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("data-running", "true", { timeout: 30_000 });
    await expect
      .poll(
        async () =>
          page
            .getByTestId("local-video")
            .evaluate((v) => (v instanceof HTMLVideoElement ? v.videoWidth : 0)),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
  },
  async seen(actor) {
    const page = actor.page;
    await ensureCall(actor);
    await expect(page.getByTestId("peer-tile").first()).toBeVisible({ timeout: SYNC });
    await expect
      .poll(
        async () => {
          const painted = await page
            .getByTestId("remote-canvas")
            .evaluateAll((els) =>
              els.some((c) => c instanceof HTMLCanvasElement && c.width > 0 && c.height > 0),
            );
          const rate = Number((await page.getByTestId("decode-rate").getAttribute("data-value")) || "0");
          return painted && rate > 0;
        },
        { timeout: SYNC, intervals: [1_000, 2_000] },
      )
      .toBe(true);
  },
};

export const driver: AppDriver = {
  app: "mero-stream",

  async createNamespace(actor, name) {
    const page = actor.page;
    await expect(page.getByTestId("stream-name-input")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("stream-name-input").fill(name);
    await page.getByTestId("create-stream").click();
    await waitRooms(page);
    streamPath = new URL(page.url()).pathname;
  },

  async createSpace(actor, name) {
    const page = actor.page;
    await gotoRooms(actor);
    await page.getByTestId("room-name-input").fill(name);
    await page.getByTestId("create-room").click();
    await page.waitForURL((u) => u.pathname === "/live", { timeout: SYNC });
    await waitCall(page);
    rooms[actor.name] = name;
  },

  async openSpace(actor, name) {
    await enterRoom(actor, name);
  },

  async invite(actor) {
    const page = actor.page;
    await gotoRooms(actor);
    await page.getByTestId("invite-namespace").click();
    const link = page.getByTestId("invite-link");
    await expect(link).toBeVisible({ timeout: 60_000 });
    const text = (await link.getAttribute("title")) || (await link.innerText());
    await page.getByTestId("invite-modal-close").click();
    return text.trim();
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    await expect(page.getByTestId("open-join")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("open-join").click();
    await expect(page.getByTestId("join-dialog")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("join-code-input").fill(link);
    await page.getByTestId("join-submit").click();
    await page.waitForURL((u) => u.pathname === streamPath, { timeout: SYNC });
    await waitRooms(page);
  },

  async afterReload(actor) {
    await waitCall(actor.page);
  },

  features: [setNickname, goLive],
  permissions: ["camera", "microphone"],
};
