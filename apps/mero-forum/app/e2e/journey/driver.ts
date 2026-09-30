import { expect, type Locator, type Page } from "@playwright/test";
import type { Actor, AppDriver, Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

function other(actor: Actor): Actor["name"] {
  return actor.name === "alice" ? "bob" : "alice";
}

function stamp(): string {
  return Date.now().toString(36);
}

async function waitForForum(page: Page): Promise<void> {
  await expect(page.getByTestId("logout")).toBeVisible({ timeout: 60_000 });
}

async function waitForForumList(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Forums", level: 1, exact: true })).toBeVisible({ timeout: 60_000 });
}

async function eventually(page: Page, target: () => Locator, ready: () => Promise<void>): Promise<void> {
  await expect
    .poll(
      async () => {
        if ((await target().count()) > 0) return true;
        await page.reload();
        await ready();
        return (await target().count()) > 0;
      },
      { timeout: SYNC, intervals: [2_000, 3_000, 5_000] },
    )
    .toBe(true);
}

async function toFeed(page: Page): Promise<void> {
  const back = page.getByRole("link", { name: "Back to the feed", exact: true });
  if (await back.isVisible().catch(() => false)) await back.click();
  await expect(page.getByRole("button", { name: "All forums", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function readyFeed(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "All forums", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function readyPost(page: Page, title: string): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible({ timeout: 30_000 });
}

function postLink(page: Page, title: string): Locator {
  return page.getByRole("link", { name: title, exact: true });
}

function postCard(page: Page, title: string): Locator {
  return page.locator("article.card", { has: postLink(page, title) });
}

async function openPost(page: Page, title: string): Promise<void> {
  if (await page.getByRole("heading", { level: 1, name: title, exact: true }).isVisible().catch(() => false)) return;
  await toFeed(page);
  await eventually(page, () => postLink(page, title), () => readyFeed(page));
  await postLink(page, title).first().click();
  await readyPost(page, title);
}

function commentRow(page: Page, body: string): Locator {
  return page.getByTestId("comment").filter({ hasText: body });
}

async function toForumList(page: Page): Promise<void> {
  const back = page.getByRole("link", { name: "Back to the feed", exact: true });
  if (await back.isVisible().catch(() => false)) await back.click();
  const allForums = page.getByRole("button", { name: "All forums", exact: true });
  if (await allForums.isVisible().catch(() => false)) await allForums.click();
  await waitForForumList(page);
}

async function enterForum(page: Page, name: string): Promise<void> {
  const row = () => page.getByTestId("forum-row").filter({ hasText: name }).and(page.locator(":enabled"));
  await eventually(page, row, () => waitForForumList(page));
  await row().first().click();
  await expect(page).toHaveURL(/\/f$/, { timeout: SYNC });
  await readyFeed(page);
}

const posts: Record<string, string> = {};
const comments: Record<string, { post: string; body: string }> = {};
const scores: Record<string, { post: string; score: string }> = {};

const createPost: Feature = {
  name: "start a discussion",
  async do(actor) {
    const page = actor.page;
    const title = `${actor.name} topic ${actor.run} ${stamp()}`;
    posts[actor.name] = title;
    await toFeed(page);
    await page.getByLabel("Start a discussion", { exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByLabel("Text", { exact: true }).fill(`body of ${title}`);
    await page.getByRole("button", { name: "Post", exact: true }).click();
    await expect(postLink(page, title)).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor, by) {
    const title = posts[by.name];
    if (!title) throw new Error(`${by.name} has not posted yet`);
    const page = actor.page;
    await toFeed(page);
    await eventually(page, () => postLink(page, title), () => readyFeed(page));
  },
};

const commentOnPost: Feature = {
  name: "comment on a discussion",
  async do(actor) {
    const post = posts[other(actor)] ?? posts[actor.name];
    if (!post) throw new Error("no post to comment on");
    const body = `${actor.name} replies ${actor.run} ${stamp()}`;
    comments[actor.name] = { post, body };
    const page = actor.page;
    await openPost(page, post);
    await page.getByLabel("Add a comment", { exact: true }).fill(body);
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(commentRow(page, body)).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor, by) {
    const c = comments[by.name];
    if (!c) throw new Error(`${by.name} has not commented yet`);
    const page = actor.page;
    await openPost(page, c.post);
    await eventually(page, () => commentRow(page, c.body), () => readyPost(page, c.post));
  },
};

const editComment: Feature = {
  name: "edit your own comment",
  async do(actor) {
    const c = comments[actor.name];
    if (!c) throw new Error(`${actor.name} has no comment to edit`);
    const body = `${c.body} edited ${stamp()}`;
    const page = actor.page;
    await openPost(page, c.post);
    await commentRow(page, c.body).first().getByTestId("edit-comment").click();
    const editing = page.getByTestId("comment").filter({ has: page.getByTestId("edit-comment-input") });
    await editing.getByTestId("edit-comment-input").fill(body);
    await editing.getByRole("button", { name: "Save", exact: true }).click();
    comments[actor.name] = { post: c.post, body };
    await expect(commentRow(page, body)).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor, by) {
    const c = comments[by.name];
    if (!c) throw new Error(`${by.name} has not edited a comment`);
    const page = actor.page;
    await openPost(page, c.post);
    await eventually(page, () => commentRow(page, c.body), () => readyPost(page, c.post));
  },
};

const upvote: Feature = {
  name: "upvote someone else's discussion",
  async do(actor) {
    const post = posts[other(actor)];
    if (!post) throw new Error("no post to upvote");
    const page = actor.page;
    await toFeed(page);
    await eventually(page, () => postLink(page, post), () => readyFeed(page));
    const card = postCard(page, post).first();
    const up = card.getByRole("button", { name: "Upvote", exact: true });
    await up.click();
    await expect(up).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await page.waitForTimeout(1_000);
    const score = (await card.locator(".score").innerText()).trim();
    scores[actor.name] = { post, score };
  },
  async seen(actor, by) {
    const s = scores[by.name];
    if (!s) throw new Error(`${by.name} has not voted yet`);
    const page = actor.page;
    await toFeed(page);
    await expect
      .poll(
        async () => {
          const card = postCard(page, s.post).first();
          if ((await card.count()) > 0 && (await card.locator(".score").innerText()).trim() === s.score) return true;
          await page.reload();
          await readyFeed(page);
          return false;
        },
        { timeout: SYNC, intervals: [2_000, 3_000, 5_000] },
      )
      .toBe(true);
  },
};

const currentForum: Record<string, string> = {};

export const driver: AppDriver = {
  app: "mero-forum",

  async createNamespace(actor, name) {
    const page = actor.page;
    await expect(page.getByTestId("space-name-input")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("space-name-input").fill(name);
    await expect(page.getByTestId("create-space")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("create-space").click();
    await expect(page).toHaveURL(/\/spaces\/[^/]+$/, { timeout: 60_000 });
    await waitForForumList(page);
  },

  async createSpace(actor, name) {
    const page = actor.page;
    await toForumList(page);
    await page.getByTestId("forum-name-input").fill(name);
    await expect(page.getByTestId("create-forum")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("create-forum").click();
    await expect(page).toHaveURL(/\/f$/, { timeout: 60_000 });
    await readyFeed(page);
    currentForum[actor.name] = name;
  },

  async openSpace(actor, name) {
    const page = actor.page;
    await toForumList(page);
    await enterForum(page, name);
    currentForum[actor.name] = name;
  },

  async invite(actor) {
    const page = actor.page;
    const current = currentForum[actor.name];
    await toForumList(page);
    await page.getByTestId("invite-space").click();
    const link = page.getByTestId("invite-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    const text = (await link.getAttribute("title")) ?? (await link.innerText());
    await page.getByTestId("invite-modal-close").click();
    await expect(page.getByTestId("invite-modal")).toBeHidden({ timeout: 10_000 });
    if (current) await enterForum(page, current);
    return text;
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    const input = page.getByTestId("join-input");
    await expect(input).toBeVisible({ timeout: 60_000 });
    await input.fill(link);
    await page.getByTestId("join-btn").click();
    await expect(page).toHaveURL(/\/spaces\/[^/]+$/, { timeout: SYNC });
    await waitForForumList(page);
  },

  async afterReload(actor) {
    await waitForForum(actor.page);
  },

  features: [createPost, commentOnPost, editComment, upvote],
};
