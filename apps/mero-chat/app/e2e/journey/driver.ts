import { deflateSync } from "node:zlib";
import { expect, type Locator, type Page } from "@playwright/test";
import { readClipboard, type Actor, type AppDriver, type Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

function other(actor: Actor): Actor["name"] {
  return actor.name === "alice" ? "bob" : "alice";
}

function stamp(): string {
  return Date.now().toString(36);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function makePng(seed: number): Buffer {
  const size = 16;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 3;
      raw[i] = (seed + x * 16) & 255;
      raw[i + 1] = ((seed >> 8) + y * 16) & 255;
      raw[i + 2] = ((x ^ y) * 16) & 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function readyHome(page: Page): Promise<void> {
  await expect(page.getByText("Browse Channels", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
}

function composer(page: Page): Locator {
  return page.getByTestId("message-composer");
}

function channelItem(page: Page, name: string): Locator {
  return page.getByTestId("channel-item").filter({ hasText: name });
}

function messageRow(page: Page, text: string): Locator {
  return page.getByTestId("message").filter({ hasText: text });
}

const currentChannel: Record<string, string> = {};

async function selectChannel(page: Page, name: string): Promise<void> {
  await expect(channelItem(page, name).first()).toBeVisible({ timeout: 30_000 });
  await channelItem(page, name).first().click();
  await expect(composer(page)).toBeVisible({ timeout: 30_000 });
}

async function inChannel(actor: Actor): Promise<void> {
  const name = currentChannel[actor.name];
  if (!name) throw new Error(`${actor.name} has not opened a channel yet`);
  await readyHome(actor.page);
  await selectChannel(actor.page, name);
}

async function eventually(actor: Actor, target: () => Locator): Promise<void> {
  const page = actor.page;
  let last = Date.now();
  await expect
    .poll(
      async () => {
        if ((await target().count()) > 0) return true;
        if (Date.now() - last > 20_000) {
          await page.reload();
          await inChannel(actor);
          last = Date.now();
        }
        return (await target().count()) > 0;
      },
      { timeout: SYNC, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);
}

async function typeAndSend(page: Page, text: string): Promise<void> {
  const editor = composer(page).locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type(text);
  await composer(page).getByRole("button", { name: "Send message" }).click();
  await expect(messageRow(page, text).first()).toBeVisible({ timeout: 30_000 });
}

async function dismissToasts(page: Page): Promise<void> {
  const close = page.getByRole("button", { name: "Dismiss notification" });
  for (let i = 0; i < 10; i++) {
    if ((await close.count()) === 0) return;
    await close
      .first()
      .click({ timeout: 2_000 })
      .catch(() => undefined);
    await page.waitForTimeout(350);
  }
}

async function clickInRow(page: Page, row: Locator, target: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        await dismissToasts(page);
        await row.hover();
        return target.click({ timeout: 5_000 }).then(
          () => true,
          () => false,
        );
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);
}

async function openMessageMenu(page: Page, row: Locator, item: string): Promise<void> {
  await clickInRow(page, row, row.getByTestId("message-action-2").first());
  await row.getByText(item, { exact: true }).click();
}

const sent: Record<string, string> = {};
const images: Record<string, { caption: string; file: string }> = {};
const reacted: Record<string, string> = {};
const deleted: Record<string, string> = {};

const sendMessage: Feature = {
  name: "send a message in a channel",
  async do(actor) {
    const text = `${actor.name} says ${actor.run} ${stamp()}`;
    sent[actor.name] = text;
    await inChannel(actor);
    await typeAndSend(actor.page, text);
  },
  async seen(actor, by) {
    const text = sent[by.name];
    if (!text) throw new Error(`${by.name} has not sent anything yet`);
    await inChannel(actor);
    await eventually(actor, () => messageRow(actor.page, text));
  },
};

const sendImage: Feature = {
  name: "send an image attachment that crosses nodes as a blob",
  async do(actor) {
    const page = actor.page;
    const caption = `${actor.name} image ${actor.run} ${stamp()}`;
    const file = `${actor.name}-${actor.run}-${stamp()}.png`;
    images[actor.name] = { caption, file };
    await inChannel(actor);
    await composer(page).getByRole("button", { name: "Attach" }).click();
    await composer(page)
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: file, mimeType: "image/png", buffer: makePng(Date.now() & 0xffff) });
    await expect(composer(page).getByRole("img", { name: file })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^Uploading /)).toHaveCount(0, { timeout: 30_000 });
    await typeAndSend(page, caption);
    await expect(messageRow(page, caption).first().getByRole("img", { name: file })).toBeVisible({
      timeout: 30_000,
    });
  },
  async seen(actor, by) {
    const sentImage = images[by.name];
    if (!sentImage) throw new Error(`${by.name} has not sent an image yet`);
    await inChannel(actor);
    const img = () => messageRow(actor.page, sentImage.caption).getByRole("img", { name: sentImage.file });
    await eventually(actor, img);
    await expect
      .poll(
        async () =>
          img()
            .first()
            .evaluate((el) => (el as HTMLImageElement).naturalWidth)
            .catch(() => 0),
        { timeout: SYNC, intervals: [1_000, 2_000, 3_000] },
      )
      .toBeGreaterThan(0);
  },
};

const react: Feature = {
  name: "react to the other person's message",
  async do(actor) {
    const target = sent[other(actor)] ?? sent[actor.name];
    if (!target) throw new Error("no message to react to");
    reacted[actor.name] = target;
    await inChannel(actor);
    const row = messageRow(actor.page, target).first();
    await clickInRow(actor.page, row, row.getByTestId("react-👍").first());
    await expect(row.getByTestId("message-reaction").filter({ hasText: "👍" })).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor, by) {
    const target = reacted[by.name];
    if (!target) throw new Error(`${by.name} has not reacted yet`);
    await inChannel(actor);
    await eventually(actor, () =>
      messageRow(actor.page, target).getByTestId("message-reaction").filter({ hasText: "👍" }),
    );
  },
};

const editMessage: Feature = {
  name: "edit your own message",
  async do(actor) {
    const old = sent[actor.name];
    if (!old) throw new Error(`${actor.name} has no message to edit`);
    const page = actor.page;
    const text = `${actor.name} edited ${actor.run} ${stamp()}`;
    await inChannel(actor);
    const row = messageRow(page, old).first();
    await openMessageMenu(page, row, "Edit message");
    const editor = page.getByTestId("message-editor").locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    sent[actor.name] = text;
    await expect(messageRow(page, text).first()).toBeVisible({ timeout: 30_000 });
    await expect(messageRow(page, text).first()).toContainText("(edited)");
  },
  async seen(actor, by) {
    const text = sent[by.name];
    if (!text) throw new Error(`${by.name} has not edited anything yet`);
    await inChannel(actor);
    await eventually(actor, () => messageRow(actor.page, text));
  },
};

const deleteMessage: Feature = {
  name: "delete a message",
  oneWay: true,
  async do(actor) {
    const page = actor.page;
    const text = `${actor.name} regrets ${actor.run} ${stamp()}`;
    deleted[actor.name] = text;
    await inChannel(actor);
    await typeAndSend(page, text);
    await openMessageMenu(page, messageRow(page, text).first(), "Delete message");
    await expect(messageRow(page, text)).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText("This message has been deleted.").first()).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor, by) {
    const text = deleted[by.name];
    if (!text) throw new Error(`${by.name} has not deleted anything yet`);
    await inChannel(actor);
    await eventually(actor, () => actor.page.getByText("This message has been deleted."));
    await expect(messageRow(actor.page, text)).toHaveCount(0, { timeout: SYNC });
  },
};

async function enterName(page: Page, name: string): Promise<void> {
  const input = page.getByPlaceholder("e.g. Alice");
  const failed = page.getByText("Something went wrong", { exact: true });
  await expect(input.or(failed).first()).toBeVisible({ timeout: SYNC });
  if (await failed.isVisible().catch(() => false)) {
    throw new Error(`the workspace popup failed: ${await page.locator("body").innerText()}`);
  }
  await input.fill(name);
  await page.getByRole("button", { name: "Join chat", exact: true }).click();
  await readyHome(page);
}

export const driver: AppDriver = {
  app: "mero-chat",

  async createNamespace(actor, name) {
    const page = actor.page;
    const fresh = page.getByRole("button", { name: "Create workspace", exact: true });
    const another = page.getByText("+ Create new workspace", { exact: true });
    await expect(fresh.or(another).first()).toBeVisible({ timeout: 60_000 });
    if (await fresh.isVisible().catch(() => false)) await fresh.click();
    else await another.click();
    await page.getByPlaceholder("e.g. My Team").fill(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await enterName(page, actor.name === "alice" ? "Alice" : "Bob");
  },

  async createSpace(actor, name) {
    const page = actor.page;
    await readyHome(page);
    await page.getByRole("button", { name: "Create channel" }).first().click();
    await page.getByPlaceholder("# channel name").fill(name);
    await page.getByRole("button", { name: "Public", exact: true }).click();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByPlaceholder("# channel name")).toBeHidden({ timeout: 30_000 });
    await selectChannel(page, name);
    currentChannel[actor.name] = name;
  },

  async openSpace(actor, name) {
    const page = actor.page;
    await readyHome(page);
    let last = Date.now();
    await expect
      .poll(
        async () => {
          if ((await channelItem(page, name).count()) > 0) return true;
          const search = page.getByPlaceholder("Search channels...");
          if (!(await search.isVisible().catch(() => false))) {
            await page.getByText("Browse Channels", { exact: true }).first().click();
          }
          const row = page.getByTestId("browse-channel").filter({ hasText: name }).first();
          const join = row.getByRole("button", { name: "Join", exact: true });
          if (await join.isEnabled().catch(() => false)) {
            await join.click();
            await expect(channelItem(page, name).first()).toBeVisible({ timeout: 15_000 }).catch(() => undefined);
          }
          if ((await channelItem(page, name).count()) > 0) return true;
          if (Date.now() - last > 20_000) {
            await page.reload();
            await readyHome(page);
            last = Date.now();
          }
          return (await channelItem(page, name).count()) > 0;
        },
        { timeout: SYNC, intervals: [2_000, 3_000, 5_000] },
      )
      .toBe(true);
    await selectChannel(page, name);
    currentChannel[actor.name] = name;
  },

  async invite(actor) {
    const page = actor.page;
    await page.getByRole("button", { name: "Invite members" }).first().click();
    const copy = page.getByRole("button", { name: "Copy invite link" });
    await expect(copy).toBeVisible({ timeout: 30_000 });
    await copy.click();
    await expect(page.getByRole("button", { name: "✓ Copied!" })).toBeVisible({ timeout: 10_000 });
    const link = (await readClipboard(page)).trim();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    return link;
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    const joinLink = page.getByText("Join existing workspace", { exact: true });
    await expect(joinLink).toBeVisible({ timeout: 60_000 });
    await joinLink.click();
    await page.getByPlaceholder(/^calimero:\/\/com\.calimero\.chat\/join/).fill(link);
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await enterName(page, actor.name === "alice" ? "Alice" : "Bob");
  },

  async afterReload(actor) {
    await readyHome(actor.page);
  },

  features: [sendMessage, sendImage, react, editMessage, deleteMessage],
};
