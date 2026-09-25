import { test, expect, type Page } from "@playwright/test";
import { element } from "../fixtures/canvas";

/**
 * Project cards show the board, not a colour.
 *
 * Each card fetches its project's `get_elements` (only once it is on screen, a
 * few at a time) and draws a small SVG of it; an empty board — or one this node
 * cannot read — is plain white. The preview is cached, so a revisit paints
 * before the node has answered.
 */

const PROJECTS = [
  { contextId: "ctx-full", name: "Full board" },
  { contextId: "ctx-empty", name: "Empty board" },
  { contextId: "ctx-broken", name: "Unreadable board" },
];

const BOARDS: Record<string, unknown[]> = {
  "ctx-full": [
    element({ id: "a", x: 0, y: 0, width: 300, height: 200, fill: "#ff0000" }),
    element({ id: "b", x: 400, y: 50, width: 120, height: 120, fill: "#0000ff", layerIndex: 1 }),
  ],
  "ctx-empty": [],
};

async function openProjects(page: Page, opts: { delayMs?: number } = {}) {
  const fetched: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("mero-tokens", JSON.stringify({
      access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LWlkZW50aXR5In0.sig",
      refresh_token: "fake-refresh",
      expires_at: Date.now() + 3600_000,
    }));
    localStorage.setItem("mero:node_url", "http://localhost:2430");
    localStorage.setItem("mero:application_id", "app-1");
  });
  await page.route("**/auth/validate", (route) => route.fulfill({ status: 200 }));
  await page.route("**/admin-api/contexts", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { contexts: [] } }) }),
  );
  // One project per subgroup: the page shows each subgroup's first context.
  await page.route("**/admin-api/groups/**/subgroups", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { subgroups: PROJECTS.map((p) => ({ groupId: `sg-${p.contextId}`, alias: p.name })) },
      }),
    }),
  );
  await page.route("**/admin-api/groups/*/contexts", (route) => {
    const sg = new URL(route.request().url()).pathname.split("/").slice(-2)[0];
    const project = PROJECTS.find((p) => `sg-${p.contextId}` === sg);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { contexts: project ? [project] : [] } }),
    });
  });
  await page.route("**/events**", (route) => route.abort());
  await page.route("**/sse**", (route) => route.abort());
  await page.route("**/jsonrpc", async (route) => {
    const body = route.request().postDataJSON() as { params?: { contextId?: string; method?: string } };
    const ctx = body?.params?.contextId ?? "";
    const method = body?.params?.method ?? "";
    if (method === "get_elements") fetched.push(ctx);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (method === "get_elements" && !(ctx in BOARDS)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "not a member", data: "not a member" } }),
      });
    }
    const value = method === "get_elements" ? BOARDS[ctx] : [];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { output: value, logs: [] } }),
    });
  });
  await page.goto("/teams/team-1/projects");
  await expect(page.getByTestId("project-card-ctx-full")).toBeVisible({ timeout: 5000 });
  return { fetched };
}

test.describe("project card previews", () => {
  test("a board with elements shows a picture of them", async ({ page }) => {
    await openProjects(page);
    const thumb = page.getByTestId("project-thumb-ctx-full");
    await expect(thumb).toHaveAttribute("data-state", "ready");
    const img = page.getByTestId("project-preview-ctx-full");
    await expect(img).toBeVisible();
    // It really decoded, and it is the board: the red shape's colour is in it.
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    const svg = await img.evaluate(async (i: HTMLImageElement) => (await fetch(i.src)).text());
    expect(svg).toContain("#ff0000");
    expect(svg).toContain("#0000ff");
  });

  test("an empty board is plain white, with no picture", async ({ page }) => {
    await openProjects(page);
    const thumb = page.getByTestId("project-thumb-ctx-empty");
    await expect(thumb).toHaveAttribute("data-state", "empty");
    await expect(page.getByTestId("project-preview-ctx-empty")).toHaveCount(0);
    expect(await thumb.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  });

  test("a board the node cannot read is white too — never an error on the card", async ({ page }) => {
    await openProjects(page);
    const thumb = page.getByTestId("project-thumb-ctx-broken");
    await expect(thumb).toHaveAttribute("data-state", "empty");
    await expect(page.getByTestId("project-preview-ctx-broken")).toHaveCount(0);
  });

  test("a revisit paints the cached preview before the node answers", async ({ page }) => {
    await openProjects(page);
    await expect(page.getByTestId("project-thumb-ctx-full")).toHaveAttribute("data-state", "ready");
    // Second visit: the node now takes 3s to answer.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await openProjects(page, { delayMs: 3000 });
    await expect(page.getByTestId("project-preview-ctx-full")).toBeVisible({ timeout: 1000 });
  });

  test("each project's board is fetched once, not per render", async ({ page }) => {
    const { fetched } = await openProjects(page);
    await expect(page.getByTestId("project-thumb-ctx-empty")).toHaveAttribute("data-state", "empty");
    await page.waitForTimeout(300);
    expect([...fetched].sort()).toEqual(["ctx-broken", "ctx-empty", "ctx-full"]);
  });
});
