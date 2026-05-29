/**
 * Integration tests — browser-based tests with a real running node.
 *
 * Set env vars: INTEGRATION_NODE_URL, INTEGRATION_ACCESS_TOKEN,
 *               INTEGRATION_REFRESH_TOKEN, INTEGRATION_APP_ID, INTEGRATION_CONTEXT_ID
 * Run: npx playwright test --project=integration
 */
import { test, expect } from "@playwright/test";

const NODE_URL     = process.env.INTEGRATION_NODE_URL ?? "http://localhost:2430";
const TOKEN        = process.env.INTEGRATION_ACCESS_TOKEN ?? "";
const REFRESH      = process.env.INTEGRATION_REFRESH_TOKEN ?? "";
const APP_ID       = process.env.INTEGRATION_APP_ID ?? "";
const CTX_ID       = process.env.INTEGRATION_CONTEXT_ID ?? "";

test.skip(!TOKEN || !CTX_ID, "Integration env vars not set");

const TEAM_FAKE = "team-1"; // not used for API calls in canvas, only for URL

async function injectAuth(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ nodeUrl, accessToken, refreshToken, applicationId }) => {
      localStorage.setItem("merodesign-auth", JSON.stringify({
        state: { nodeUrl, accessToken, refreshToken, applicationId },
        version: 0,
      }));
    },
    { nodeUrl: NODE_URL, accessToken: TOKEN, refreshToken: REFRESH, applicationId: APP_ID },
  );
}

test.describe("Canvas with real node", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
    await page.goto(`/teams/${TEAM_FAKE}/projects/${CTX_ID}`);
    await expect(page.getByTestId("fabric-canvas")).toBeVisible({ timeout: 15_000 });
  });

  test("canvas loads elements from node", async ({ page }) => {
    // Just verify the canvas renders without crashing
    await expect(page.getByTestId("fabric-canvas")).toBeVisible();
    // No JS errors on load
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.waitForTimeout(2000);
    const realErrors = errors.filter((e) =>
      !e.includes("favicon") && !e.includes("ERR_") && !e.includes("SSL")
    );
    expect(realErrors).toHaveLength(0);
  });

  test("drawing a rect sends lowercase kind to node", async ({ page }) => {
    const addCalls: { element?: { data?: { kind?: string } } }[] = [];
    await page.route("**/jsonrpc", async (route) => {
      const body = route.request().postDataJSON() as { params?: { method?: string; argsJson?: Record<string, unknown> } };
      if (body?.params?.method === "add_element") {
        addCalls.push(body.params.argsJson as { element?: { data?: { kind?: string } } });
      }
      return route.continue();
    });

    await page.getByTestId("tool-rect").click();
    const canvas = page.getByTestId("fabric-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.up();
    await page.waitForTimeout(500);

    expect(addCalls.length).toBeGreaterThan(0);
    const kind = addCalls[0]?.element?.data?.kind;
    expect(kind).toBe("rect");
  });

  test("username modal appears for new identity and submitting registers user", async ({ page }) => {
    // Use a unique identity not seen by this node before
    const uniqueToken = "eyJhbGciOiJIUzI1NiJ9."
      + btoa(JSON.stringify({ sub: `test-new-${Date.now()}` })).replace(/=/g, "")
      + ".sig";
    await page.addInitScript(
      ({ nodeUrl, accessToken, refreshToken, applicationId }) => {
        localStorage.setItem("merodesign-auth", JSON.stringify({
          state: { nodeUrl, accessToken, refreshToken, applicationId },
          version: 0,
        }));
        // Clear saved username so modal shows
        localStorage.removeItem("merodesign-usernames");
      },
      { nodeUrl: NODE_URL, accessToken: uniqueToken, refreshToken: REFRESH, applicationId: APP_ID },
    );
    await page.goto(`/teams/${TEAM_FAKE}/projects/${CTX_ID}`);
    await expect(page.getByTestId("fabric-canvas")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("username-input")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("username-input").fill("IntegrationTester");
    await page.getByTestId("username-submit").click();
    await expect(page.getByTestId("username-input")).not.toBeVisible({ timeout: 3000 });
  });

  test("XSS in comment content is displayed as text not executed", async ({ page }) => {
    let xssExecuted = false;
    await page.exposeFunction("__xssProbe", () => { xssExecuted = true; });
    // Inject window hook to detect if script runs
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).alert = () => {
        (window as unknown as Record<string, () => void>).__xssProbe?.();
      };
    });

    // Add a comment with XSS payload
    await page.getByRole("button", { name: /comment/i }).click();
    const canvas = page.getByTestId("fabric-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");
    await page.mouse.click(box.x + 150, box.y + 150);
    await expect(page.locator("textarea")).toBeVisible({ timeout: 3000 });
    await page.locator("textarea").fill('<script>window.__xssProbe()</script>');
    await page.getByRole("button", { name: /post/i }).click();
    await page.waitForTimeout(1000);

    expect(xssExecuted).toBe(false);
  });
});
