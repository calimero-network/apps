import { expect, type Locator, type Page } from "@playwright/test";
import type { Actor, AppDriver, Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

function other(actor: Actor): Actor["name"] {
  return actor.name === "alice" ? "bob" : "alice";
}

function stamp(): string {
  return Date.now().toString(36);
}

async function settleAliasGate(actor: Actor, timeout = 10_000): Promise<void> {
  const page = actor.page;
  const gate = page.getByTestId("alias-gate");
  const shown = await gate
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
  if (!shown) return;
  await page.getByTestId("alias-gate-name").fill(`${actor.name}-${actor.run}`);
  await page.getByTestId("alias-gate-save").click();
  const gone = await gate
    .waitFor({ state: "detached", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!gone) {
    await page.getByTestId("alias-gate-skip").click();
    await gate.waitFor({ state: "detached", timeout: 5_000 });
  }
}

async function press(actor: Actor, target: Locator): Promise<void> {
  try {
    await target.click({ timeout: 5_000 });
  } catch {
    await settleAliasGate(actor, 5_000);
    await target.click({ timeout: 15_000 });
  }
}

async function waitForShell(actor: Actor): Promise<void> {
  const page = actor.page;
  await expect(page.getByTestId("ns-switcher").or(page.getByTestId("ns-empty-state")).first()).toBeVisible({
    timeout: 60_000,
  });
}

async function waitForBoard(actor: Actor): Promise<void> {
  await expect(actor.page.getByTestId("workspace-ready")).toBeVisible({ timeout: 60_000 });
  await settleAliasGate(actor, 3_000);
}

async function eventually(actor: Actor, check: () => Promise<boolean>, message: string): Promise<void> {
  let refreshed = Date.now();
  await expect
    .poll(
      async () => {
        if (await check().catch(() => false)) return true;
        if (Date.now() - refreshed > 25_000) {
          refreshed = Date.now();
          await actor.page.reload();
          await waitForBoard(actor).catch(() => undefined);
        }
        return false;
      },
      { message, timeout: SYNC, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);
}

function allIssuesLink(page: Page): Locator {
  return page.getByRole("navigation").getByRole("link", { name: /^All Issues/ });
}

async function openList(actor: Actor): Promise<void> {
  await press(actor, allIssuesLink(actor.page));
  await waitForBoard(actor);
}

function issueRow(page: Page, title: string): Locator {
  return page.getByTestId("item-issue").filter({ hasText: title });
}

function issueHeading(page: Page): Locator {
  return page.getByTestId("workspace-ready").locator("h1.title");
}

async function openIssue(actor: Actor, title: string): Promise<void> {
  const page = actor.page;
  await openList(actor);
  const row = issueRow(page, title).first();
  await expect(row).toBeVisible({ timeout: SYNC });
  await press(actor, row);
  await expect(issueHeading(page)).toHaveText(title, { timeout: 30_000 });
}

async function onIssue(actor: Actor, title: string): Promise<boolean> {
  const page = actor.page;
  const heading = issueHeading(page);
  if ((await heading.isVisible()) && (await heading.innerText()).trim() === title) {
    await page.getByTestId("action-back").click();
  } else {
    await press(actor, allIssuesLink(page));
  }
  const row = issueRow(page, title).first();
  if (!(await row.isVisible())) return false;
  await row.click();
  await expect(heading).toHaveText(title, { timeout: 10_000 });
  return true;
}

const issues: Record<string, { title: string }> = {};
const statuses: Record<string, { title: string; status: string }> = {};
const comments: Record<string, { title: string; body: string }> = {};
const labels: Record<string, { title: string; label: string }> = {};

const createIssue: Feature = {
  name: "create an issue",
  async do(actor) {
    const page = actor.page;
    const title = `issue ${actor.name} ${actor.run} ${stamp()}`;
    issues[actor.name] = { title };
    await openList(actor);
    await press(actor, page.getByTestId("open-new-issue-btn"));
    await page.getByTestId("field-title").fill(title);
    await page.getByTestId("field-description").fill(`summary by ${actor.name}`);
    await page.getByTestId("field-impact").fill(`impact by ${actor.name}`);
    await page.getByTestId("field-repro").fill(`repro by ${actor.name}`);
    await page.getByTestId("field-resolution_criteria").fill(`resolved when ${actor.name} says so`);
    await page.getByTestId("action-create_issue").click();
    await expect(page.getByTestId("action-create_issue")).toHaveCount(0, { timeout: 30_000 });
    await expect(issueRow(page, title)).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor, by) {
    const i = issues[by.name];
    if (!i) throw new Error(`${by.name} has not created an issue yet`);
    await eventually(
      actor,
      async () => {
        await press(actor, allIssuesLink(actor.page));
        return (await issueRow(actor.page, i.title).count()) > 0;
      },
      `${actor.name} sees ${by.name}'s issue in the list`,
    );
  },
};

const changeStatus: Feature = {
  name: "change an issue's status",
  async do(actor) {
    const page = actor.page;
    const target = issues[other(actor)] ?? issues[actor.name];
    if (!target) throw new Error("no issue to change");
    const status = actor.name === "alice" ? "In progress" : "Blocked";
    statuses[actor.name] = { title: target.title, status };
    await openIssue(actor, target.title);
    const control = page.getByTestId("action-set_status");
    await press(actor, control);
    await page.getByRole("listbox").getByRole("option", { name: status, exact: true }).click();
    await expect(control).toContainText(status, { timeout: 30_000 });
  },
  async seen(actor, by) {
    const s = statuses[by.name];
    if (!s) throw new Error(`${by.name} has not changed a status yet`);
    await eventually(
      actor,
      async () =>
        (await onIssue(actor, s.title)) &&
        (await actor.page.getByTestId("action-set_status").innerText()).includes(s.status),
      `${actor.name} sees ${by.name}'s status ${s.status}`,
    );
  },
};

const addComment: Feature = {
  name: "comment on an issue",
  async do(actor) {
    const page = actor.page;
    const target = issues[other(actor)] ?? issues[actor.name];
    if (!target) throw new Error("no issue to comment on");
    const body = `comment ${actor.name} ${actor.run} ${stamp()}`;
    comments[actor.name] = { title: target.title, body };
    await openIssue(actor, target.title);
    await page.getByTestId("field-body").fill(body);
    await page.getByTestId("action-add_comment").click();
    await expect(page.getByTestId("item-comment").filter({ hasText: body })).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor, by) {
    const c = comments[by.name];
    if (!c) throw new Error(`${by.name} has not commented yet`);
    await eventually(
      actor,
      async () =>
        (await onIssue(actor, c.title)) &&
        (await actor.page.getByTestId("item-comment").filter({ hasText: c.body }).count()) > 0,
      `${actor.name} sees ${by.name}'s comment`,
    );
  },
};

const addLabel: Feature = {
  name: "label an issue",
  async do(actor) {
    const page = actor.page;
    const target = issues[other(actor)] ?? issues[actor.name];
    if (!target) throw new Error("no issue to label");
    const label = `l-${actor.name}-${stamp()}`;
    labels[actor.name] = { title: target.title, label };
    await openIssue(actor, target.title);
    await press(actor, page.getByTestId("action-add_label"));
    await page.getByTestId("field-label").fill(label);
    await page.getByTestId("field-label").press("Enter");
    await expect(page.getByLabel(`Remove ${label}`, { exact: true })).toHaveCount(1, { timeout: 30_000 });
  },
  async seen(actor, by) {
    const l = labels[by.name];
    if (!l) throw new Error(`${by.name} has not labelled anything yet`);
    await eventually(
      actor,
      async () =>
        (await onIssue(actor, l.title)) &&
        (await actor.page.getByLabel(`Remove ${l.label}`, { exact: true }).count()) > 0,
      `${actor.name} sees ${by.name}'s label`,
    );
  },
};

export const driver: AppDriver = {
  app: "mero-issue-tracker",

  async createNamespace(actor, name) {
    const page = actor.page;
    await waitForShell(actor);
    await press(actor, page.getByTestId("ns-create-btn").first());
    await page.getByTestId("ns-create-name").fill(name);
    await page.getByTestId("ns-create-submit").click();
    await expect(page.getByTestId("ns-create-name")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("ns-switcher")).toContainText(name, { timeout: 30_000 });
    await settleAliasGate(actor);
  },

  async createSpace(actor, name) {
    const page = actor.page;
    await press(actor, page.getByTestId("repo-add-btn"));
    await page.getByTestId("repo-add-name").fill(name);
    await page.getByTestId("repo-add-url").fill(`https://github.com/journey/${name}`);
    await page.getByTestId("repo-add-submit").click();
    await expect(page.getByTestId("repo-add-name")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("repo-header-name")).toHaveText(name, { timeout: 30_000 });
    await waitForBoard(actor);
  },

  async openSpace(actor, name) {
    const page = actor.page;
    const item = page.getByTestId("repo-list-item").filter({ hasText: name });
    await eventually(actor, async () => (await item.count()) > 0, `${actor.name} sees the repo ${name}`);
    await press(actor, item.first());
    await expect(page.getByTestId("repo-header-name")).toHaveText(name, { timeout: 30_000 });
    await waitForBoard(actor);
  },

  async invite(actor) {
    const page = actor.page;
    await press(actor, page.getByTestId("nav-members"));
    const nudge = page.getByTestId("alias-input");
    if (await nudge.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) {
      await page.keyboard.press("Escape");
      await expect(nudge).toHaveCount(0, { timeout: 5_000 });
    }
    const open = page.getByTestId("open-invite-btn");
    await expect(open).toBeEnabled({ timeout: 30_000 });
    await press(actor, open);
    await page.getByTestId("generate-invite-btn").click();
    const output = page.getByTestId("invite-code-output");
    await expect(output).not.toHaveValue("", { timeout: 30_000 });
    const link = (await output.inputValue()).trim();
    await page.keyboard.press("Escape");
    await expect(output).toHaveCount(0, { timeout: 5_000 });
    await openList(actor);
    return link;
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    await waitForShell(actor);
    await press(actor, page.getByTestId("ns-join-btn").first());
    await page.getByTestId("join-code-input").fill(link);
    await page.getByTestId("join-submit-btn").click();
    await expect(page.getByTestId("join-code-input")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId("ns-switcher")).toBeVisible({ timeout: 30_000 });
    await settleAliasGate(actor);
  },

  async afterReload(actor) {
    await waitForBoard(actor);
  },

  features: [createIssue, changeStatus, addComment, addLabel],
};
