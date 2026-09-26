import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readState } from "./global-setup";

/**
 * The founder's whole loop, through the UI, against a real node:
 *
 *   connect → create the company → create an audience → name yourself →
 *   settings + categories → publish from a template (draft autosaves first) →
 *   react and reply → open a question and answer it → reuse the last update,
 *   where last month's KPI comes back pre-filled and the delta is computed →
 *   the KPI page charts two reports.
 *
 * One node is one account, so this is the TEAM side. The investor side —
 * a second account reading, offering help, asking — is two-node territory and
 * lives in logic/workflows/e2e.yml.
 */

const SHOTS = process.env["SHOTS_DIR"];
const HERE = path.dirname(fileURLToPath(import.meta.url));

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.resolve(HERE, "..", SHOTS, `${name}.png`), fullPage: true });
}

async function login(page: Page) {
  const s = readState();
  await page.addInitScript(
    ([key, url]) => window.localStorage.setItem(key, url),
    ["mero:node_url", s.nodeUrl] as const,
  );
  const params = new URLSearchParams({
    access_token: s.accessToken,
    refresh_token: s.refreshToken,
    node_url: s.nodeUrl,
  });
  await page.goto(`/#${params.toString()}`);
}

test("a founder sets up, publishes, and the conversation works", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await login(page);

  // ── company and audience ─────────────────────────────────────────────────
  await expect(page).toHaveURL(/\/companies$/);
  await page.getByTestId("space-name-input").fill("Acme");
  await page.getByTestId("create-space").click();
  await expect(page).toHaveURL(/\/companies\/[^/]+$/, { timeout: 60_000 });
  await expect(page.getByTestId("audience-scope-note")).toBeVisible();
  await page.getByTestId("audience-name-input").fill("All investors");
  await page.getByTestId("create-audience").click();
  await expect(page).toHaveURL(/\/a$/, { timeout: 60_000 });

  // ── first visit: who are you ─────────────────────────────────────────────
  const prompt = page.getByTestId("profile-prompt");
  await expect(prompt).toBeVisible();
  await prompt.getByLabel("Your name").fill("Ana Founder");
  await prompt.getByLabel("Company or role").fill("CEO");
  await prompt.getByRole("button", { name: "Save" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(page.getByText("Admin", { exact: true })).toBeVisible();
  await expect(page.getByTestId("team-panel")).toBeVisible();
  await shot(page, "01-home-empty");

  // ── settings and categories ──────────────────────────────────────────────
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Company name").fill("Acme Inc.");
  await page.getByLabel("Update cadence").selectOption("30");
  await page.getByTestId("settings").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByTestId("starter-categories").click();
  await expect(page.locator(".categoryRow")).toHaveCount(5, { timeout: 30_000 });
  await expect(page.getByTestId("company-name")).toHaveText("Acme Inc.");
  await shot(page, "02-settings");

  // ── compose from a template ──────────────────────────────────────────────
  await page.getByRole("link", { name: "Updates" }).click();
  await page.getByRole("button", { name: /Monthly update/ }).first().click();
  const composer = page.getByTestId("composer");
  await expect(composer).toBeVisible();
  await composer.getByLabel("Title").fill("June 2026 update");
  await composer.getByLabel("Category").selectOption({ label: "📅 Monthly update" });
  await composer.getByLabel("Summary").fill("First enterprise customer, two senior hires.");
  await composer.getByLabel("Highlights").fill("Closed Globex, our first enterprise logo.");
  await composer.getByLabel("Lowlights").fill("Churned two SMB accounts.");
  await composer.getByRole("button", { name: "+ KPI" }).click();
  await composer.getByLabel("KPI name").fill("MRR");
  await composer.getByLabel("MRR value").fill("$42k");
  await composer.getByLabel("Ask", { exact: true }).fill("Intro to a CFO at a Series B fintech");
  // The draft autosaves to the node before anything is published.
  await expect(page.getByTestId("draft-status")).toContainText("Draft saved on this node", { timeout: 20_000 });
  await expect(page).toHaveURL(/compose\?draft=/);
  await composer.getByRole("tab", { name: "Preview" }).click();
  await expect(page.getByTestId("preview")).toContainText("June 2026 update");
  await shot(page, "03-preview");
  await composer.getByRole("tab", { name: "Write" }).click();
  await page.getByTestId("publish").click();

  // ── the published update ─────────────────────────────────────────────────
  const post = page.getByTestId("post");
  await expect(post.getByRole("heading", { level: 1 })).toHaveText("June 2026 update", { timeout: 30_000 });
  await expect(post.locator(".kpi")).toContainText("$42k");
  await expect(post.getByTestId("ask")).toContainText("Intro to a CFO");
  // Empty template sections are not published.
  await expect(post.locator(".postSection h2")).toHaveText(["Highlights", "Lowlights"]);

  await page.getByTestId("react-open").click();
  await page.getByRole("menuitemcheckbox", { name: "🎉" }).click();
  await expect(post.locator(".reaction[aria-pressed='true']")).toContainText("1");

  await page.getByTestId("reply-box").locator("textarea").fill("Board deck is in the data room.");
  await page.getByTestId("reply-box").getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("comment")).toContainText("Board deck is in the data room.");
  await shot(page, "04-post");

  // The draft was consumed by publishing.
  await page.getByRole("link", { name: "Updates", exact: true }).first().click();
  await expect(page.getByTestId("update-row")).toHaveCount(1);
  await expect(page.locator(".drafts")).toHaveCount(0);
  await expect(page.locator(".due")).toContainText("Due in 30 days");
  await shot(page, "05-home");

  // ── Q&A ──────────────────────────────────────────────────────────────────
  await page.getByRole("link", { name: "Q&A" }).click();
  await page.getByTestId("question-box").getByLabel("Question").fill("Office hours this Friday — bring questions");
  await page.getByTestId("question-box").getByRole("button", { name: "Post" }).click();
  await expect(post.getByRole("heading", { level: 1 })).toHaveText("Office hours this Friday — bring questions");
  await page.getByRole("button", { name: "Mark answered" }).click();
  await expect(post.locator(".pill").first()).toHaveText("Answered");

  // ── reuse the last update: KPIs carry over, delta is computed ────────────
  await page.getByRole("link", { name: "Updates", exact: true }).first().click();
  await page.getByRole("button", { name: /Reuse the last one/ }).click();
  await expect(composer).toBeVisible();
  const mrr = composer.getByLabel("MRR value");
  await expect(mrr).toHaveAttribute("placeholder", "last: $42k");
  await mrr.fill("$48k");
  await expect(composer.locator(".metricDelta").first()).toHaveText("+14%");
  await composer.getByLabel("Highlights").fill("Signed Initech.");
  await shot(page, "06-compose-reuse");
  await page.getByTestId("publish").click();
  await expect(post.locator(".kpiDelta")).toContainText("+14%", { timeout: 30_000 });

  await page.getByRole("link", { name: "KPIs" }).click();
  await expect(page.getByTestId("metric-card")).toContainText("2 reports");
  await expect(page.getByTestId("metric-card")).toContainText("$48k");
  await shot(page, "07-kpis");

  await page.getByRole("link", { name: "People" }).click();
  await expect(page.getByTestId("person").first()).toContainText("Ana Founder");
  await expect(page.getByTestId("following")).toBeVisible();
  await shot(page, "08-people");

  expect(errors, "an unhandled error escaped to the page").toEqual([]);
});
