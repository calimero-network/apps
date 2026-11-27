/**
 * Sylence end to end on `merod local`: a person signs up with a passkey and
 * makes a workspace; meetings arrive in it through the contract (as the
 * extension writes them); the list, search, a meeting's page and its action
 * items work on them; the extension's sign-in window hands a session over.
 *
 * One account and one workspace for the whole file: the steps build on each
 * other (`workers: 1`, a serial describe sharing one page).
 */
import { webcrypto } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { seedMeetings, withPasskey, type Seeded } from "./sylence.ts";

const EXTENSION_ID = "ljpjgindjakdpmbpjdcpadihhnaemocf";
const CALLBACK = `https://${EXTENSION_ID}.chromiumapp.org/`;

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let seeded: Seeded;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  page = await context.newPage();
  await withPasskey(context, page);
});

test.afterAll(async () => {
  await context?.close();
});

const row = (title: string) => page.getByTestId("meeting-row").filter({ hasText: title });

test("signs up with a passkey and makes a workspace", async () => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Meeting notes that write themselves");
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await page.getByTestId("signup-passkey").click();
  await page.getByTestId("signup-create").click();
  // Signed in with no workspace: the picker.
  await page.getByRole("button", { name: "Start a new workspace" }).click();
  await page.getByPlaceholder("e.g. Product team").fill("Launch team");
  await page.getByPlaceholder("e.g. Alice").fill("Eve");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByTestId("empty-meetings")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Record your first meeting" })).toBeVisible();
  await expect(page.locator(".team-name")).toContainText("Launch team");
});

test("lists every meeting of the workspace, newest first, with live badge and counts", async () => {
  seeded = await seedMeetings(page, [
    {
      title: "Pricing review",
      platform: "zoom",
      summary: "The new pricing page ships on Friday.",
      lines: [
        { speaker: "you", text: "Morning, let's look at the pricing page." },
        { speaker: "others", text: "The table needs one more column for teams." },
        { speaker: "you", text: "Eve, can you send the deck by Friday?" },
        { speaker: "others", text: "Yes, and I'll ask the pelican team for numbers." },
      ],
      actions: [{ text: "Send the deck", assignee: "Eve", seq: 2 }],
    },
    {
      title: "Design sync",
      platform: "teams",
      lines: [
        { speaker: "others", text: "The record button should be the only big thing." },
        { speaker: "you", text: "Agreed. The model goes in a sheet." },
      ],
    },
    {
      title: "Weekly standup",
      platform: "meet",
      live: true,
      lines: [{ speaker: "you", text: "Quick round, what did everyone ship?" }],
    },
  ]);
  const rows = page.getByTestId("meeting-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.locator(".meeting-title")).toHaveText([/Weekly standup/, /Design sync/, /Pricing review/]);
  await expect(row("Weekly standup").getByTestId("live-badge")).toBeVisible();
  await expect(page.getByTestId("live-badge")).toHaveCount(1);
  await expect(row("Pricing review").locator(".has-open")).toHaveText("1");
  await expect(page.getByRole("tab", { name: /Open action items/ }).locator(".count")).toHaveText("1");
});

test("search: titles at once, transcript lines after a pause, a hit opens its line", async () => {
  const box = page.getByRole("searchbox", { name: "Search meetings" });
  await box.fill("sync");
  await expect(page.getByTestId("meeting-row")).toHaveCount(1);
  await expect(page.getByTestId("meeting-row")).toContainText("Design sync");

  // A word said only in a transcript.
  await box.fill("pelican");
  const hit = page.getByTestId("search-hit");
  await expect(hit).toHaveCount(1);
  await expect(hit.locator("mark")).toHaveText("pelican");
  await expect(hit).toContainText("Pricing review");
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`#/m/${seeded.ids["Pricing review"]}/3$`));
  const focused = page.locator(".segment.focused");
  await expect(focused).toHaveCount(1);
  await expect(focused).toContainText("pelican team");

  // Find in this transcript.
  const find = page.getByRole("searchbox", { name: "Find in transcript" });
  await find.fill("deck friday");
  await expect(page.getByTestId("segment")).toHaveCount(1);
  await expect(page.getByTestId("segment").locator("mark")).toHaveText(["deck", "Friday"]);
  await expect(page.getByTestId("line-count")).toHaveText("1 of 4 lines");
  await find.fill("zebra");
  await expect(page.getByText(/No line contains/)).toBeVisible();
  await find.fill("");
  await expect(page.getByTestId("segment")).toHaveCount(4);

  await page.getByRole("button", { name: "All meetings" }).click();
  await page.getByRole("searchbox", { name: "Search meetings" }).fill("nothing like this");
  await expect(page.getByTestId("no-match")).toContainText("in titles or transcripts");
  await page.getByRole("searchbox", { name: "Search meetings" }).fill("");
});

test("a meeting: rename, summary, edit a line, action items, Markdown", async () => {
  await row("Design sync").click();
  await expect(page.getByRole("heading", { level: 1, name: "Design sync" })).toBeVisible();

  await page.getByRole("button", { name: "Rename meeting" }).click();
  await page.getByLabel("Meeting title").fill("Design review");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Design review" })).toBeVisible();

  await page.getByRole("button", { name: "Write one" }).click();
  await page.getByRole("textbox", { name: "Summary" }).fill("Record stays the only big button.");
  await page.getByRole("button", { name: "Save summary" }).click();
  await expect(page.locator(".summary-text")).toHaveText("Record stays the only big button.");

  const second = page.getByTestId("segment").nth(1);
  await second.hover();
  await second.getByRole("button", { name: "Edit line" }).click();
  await page.getByLabel("Segment text").fill("Agreed. The model picker goes in a sheet.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(second).toContainText("The model picker goes in a sheet.");
  await expect(second).toContainText("(edited)");

  await second.hover();
  await second.getByRole("button", { name: "Make action item" }).click();
  const item = page.getByRole("checkbox", { name: /The model picker goes in a sheet/ });
  await expect(item).toBeVisible();
  await expect(page.locator(".actions-card .card-head .pill")).toHaveText("1 open");

  await page.getByLabel("New action item").fill("Draw the sheet");
  await page.getByLabel("Assignee").fill("Cy");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.locator(".actions-card .card-head .pill")).toHaveText("2 open");
  // The box follows the contract's answer, not the click.
  await item.click();
  await expect(item).toBeChecked();
  await expect(page.locator(".actions-card .card-head .pill")).toHaveText("1 open");

  await page.getByRole("button", { name: "Copy as Markdown" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const markdown = await page.evaluate(() => navigator.clipboard.readText());
  expect(markdown).toContain("# Design review");
  expect(markdown).toContain("- [x] Agreed. The model picker goes in a sheet.");
  expect(markdown).toContain("- [ ] Draw the sheet (Cy)");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .md" }).click();
  expect((await download).suggestedFilename()).toMatch(/design-review.*\.md$/i);

  await page.getByRole("button", { name: "All meetings" }).click();
  await expect(row("Design review")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Open action items/ }).locator(".count")).toHaveText("2");
  await page.getByRole("tab", { name: /Open action items/ }).click();
  await expect(page.getByText("Draw the sheet")).toBeVisible();
  await expect(page.getByText("Send the deck")).toBeVisible();
  await page.getByRole("tab", { name: "Meetings" }).click();
});

test("deletes a meeting with its transcript and action items", async () => {
  await row("Pricing review").click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete for everyone" }).click();
  await expect(page.getByTestId("meeting-row")).toHaveCount(2);
  await expect(row("Pricing review")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Open action items/ }).locator(".count")).toHaveText("1");
  await page.getByRole("searchbox", { name: "Search meetings" }).fill("pelican");
  await expect(page.getByTestId("no-match")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search meetings" }).fill("");
});

test("dark theme, and selects drawn by the page", async () => {
  await page.getByRole("button", { name: "account menu" }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(12, 12, 14)");
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // The picker offers this workspace's organization in a select.
  await page.getByRole("button", { name: "Switch workspace" }).click();
  const select = page.getByRole("combobox", { name: "organization" });
  await expect(select).toBeVisible();
  const look = await select.evaluate((el) => {
    const s = getComputedStyle(el);
    return { appearance: s.appearance, image: s.backgroundImage, radius: s.borderRadius };
  });
  expect(look.appearance).toBe("none");
  expect(look.image).toContain("data:image/svg+xml");
  expect(look.radius).toBe("8px");
  await page.getByRole("button", { name: /Launch team/ }).click();
  await expect(page.getByTestId("meeting-row")).toHaveCount(2);
});

/** A sign-in request as the extension makes one: a fresh P-256 key and state. */
async function nativeRequest(): Promise<{ state: string; key: string }> {
  const pair = (await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const raw = Buffer.from(await webcrypto.subtle.exportKey("raw", pair.publicKey));
  return { state: Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64url"), key: raw.toString("base64url") };
}

test("the extension's window: asked to create, it shows only the start form; then hands the session over", async () => {
  const req = await nativeRequest();
  let answer: string | null = null;
  await context.route(`${CALLBACK}**`, (route) => {
    answer = route.request().url();
    return route.fulfill({ status: 200, contentType: "text/html", body: "<p>signed in</p>" });
  });

  await page.goto("about:blank");
  await page.goto(`/#native-sign-in&state=${req.state}&key=${req.key}&intent=create`);
  // The page keeps no session for the extension: a passkey sign-in, said to be for it.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to the Sylence extension");
  await page.getByRole("button", { name: /Sign in with passkey/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Create a workspace" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Start a workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your workspaces" })).toHaveCount(0);

  // Cancel: the session goes to the extension's fixed callback, sealed to its key.
  await page.getByRole("button", { name: "Cancel" }).click();
  // The fragment never reaches the network: read it from the address the page went to.
  await page.waitForURL(`${CALLBACK}**`, { timeout: 30_000 });
  expect(answer).not.toBeNull();
  const url = new URL(page.url());
  expect(url.origin + url.pathname).toBe(`${CALLBACK}signed-in`);
  const params = new URLSearchParams(url.hash.slice(1));
  expect(params.get("state")).toBe(req.state);
  expect((params.get("box") ?? "").length).toBeGreaterThan(100);
});

test("the extension's window: an account with workspaces is handed over at once", async () => {
  const req = await nativeRequest();
  let answer: string | null = null;
  await context.unrouteAll();
  await context.route(`${CALLBACK}**`, (route) => {
    answer = route.request().url();
    return route.fulfill({ status: 200, contentType: "text/html", body: "<p>signed in</p>" });
  });
  await page.goto("about:blank");
  await page.goto(`/#native-sign-in&state=${req.state}&key=${req.key}`);
  await page.getByRole("button", { name: /Sign in with passkey/ }).click();
  await page.waitForURL(`${CALLBACK}**`, { timeout: 30_000 });
  expect(answer).not.toBeNull();
  const params = new URLSearchParams(new URL(page.url()).hash.slice(1));
  expect(params.get("state")).toBe(req.state);
  expect((params.get("box") ?? "").length).toBeGreaterThan(100);
});
