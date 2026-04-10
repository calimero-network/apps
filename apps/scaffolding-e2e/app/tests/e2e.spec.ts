/**
 * E2E test — opens the in-app TestRunner, clicks "Run All Tests",
 * waits for all tests to complete, and asserts zero failures.
 *
 * Prerequisites:
 *   1. merod running:  merod --home ~/.calimero/node1 run
 *   2. App running:    pnpm dev  (in /frontend)
 *   3. Auth saved:     pnpm run test:auth  (one-time)
 *   4. Run tests:      pnpm test
 */

import { test, expect, Page } from "@playwright/test";

const TOTAL_TESTS = 81; // keep in sync with TestRunner.tsx TESTS array length

// ── helpers ───────────────────────────────────────────────────────────────────

async function navigateToTestRunner(page: Page) {
  await page.goto("/");
  // Wait until we're past the ConnectScreen (sidebar visible)
  await page.locator(".sidebar").waitFor({ timeout: 15_000 });
  // Click "Run All Tests" in the sidebar
  await page.locator(".sidebar-item", { hasText: "Run All Tests" }).click();
  // Wait for the test runner section to load
  await page.locator('[data-testid="test-summary"]').waitFor({ timeout: 10_000 });
}

async function waitForAllComplete(page: Page) {
  // Wait until no test has status="running" and all have pass or fail
  await page.waitForFunction(
    (total) => {
      const items = document.querySelectorAll("[data-testid^='test-']");
      const done = [...items].filter(
        (el) => el.getAttribute("data-status") === "pass" || el.getAttribute("data-status") === "fail",
      );
      return done.length >= total;
    },
    TOTAL_TESTS,
    { timeout: 90_000, polling: 500 },
  );
}

// ── main spec ─────────────────────────────────────────────────────────────────

test.describe("Test Runner", () => {
  test("all tests pass", async ({ page }) => {
    await navigateToTestRunner(page);

    // Click Run All Tests
    await page.click('[data-testid="btn-run-all"]');

    // Wait for completion
    await waitForAllComplete(page);

    // Assert zero failures
    const failedEls = await page.locator("[data-testid^='test-'][data-status='fail']").all();

    if (failedEls.length > 0) {
      // Collect failure details for the error message
      const failures: string[] = [];
      for (const el of failedEls) {
        const testId = await el.getAttribute("data-testid");
        const name = await el.locator("span").first().textContent();
        const error = await el.locator(".result-box, [style*='color: var(--color-error)']").textContent().catch(() => "");
        failures.push(`  ${testId}: ${name?.trim()} — ${error?.trim()}`);
      }
      throw new Error(`${failedEls.length} test(s) failed:\n${failures.join("\n")}`);
    }

    // Verify the summary shows "all passed"
    await expect(page.locator('[data-testid="test-summary"]')).toContainText("all passed");
  });
});

// ── per-group specs ───────────────────────────────────────────────────────────

const GROUPS = [
  "KV Operations",
  "KV Handlers",
  "User Storage",
  "Frozen Storage",
  "Private Storage",
  "Blob Storage",
  "CRDT Counters",
  "CRDT Registers",
  "CRDT Metadata",
  "CRDT Metrics",
  "CRDT Tags",
  "RGA Document",
  "Workspace",
];

test.describe("Per-group", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToTestRunner(page);
  });

  for (const group of GROUPS) {
    test(`${group} — all pass`, async ({ page }) => {
      const groupId = group.replace(/\s+/g, "-").toLowerCase();
      const groupEl = page.locator(`[data-testid="group-${groupId}"]`);

      await groupEl.locator("button:has-text('Run')").click();

      // Wait for this group's tests to finish
      const testEls = groupEl.locator("[data-testid^='test-']");
      const count = await testEls.count();

      await page.waitForFunction(
        ([gId, total]: [string, number]) => {
          const g = document.querySelector(`[data-testid="group-${gId}"]`);
          if (!g) return false;
          const done = [...g.querySelectorAll("[data-testid^='test-']")].filter(
            (el) =>
              el.getAttribute("data-status") === "pass" ||
              el.getAttribute("data-status") === "fail",
          );
          return done.length >= total;
        },
        [groupId, count] as [string, number],
        { timeout: 60_000, polling: 300 },
      );

      const failed = await groupEl.locator("[data-status='fail']").count();
      expect(failed, `${group}: ${failed} test(s) failed`).toBe(0);
    });
  }
});
