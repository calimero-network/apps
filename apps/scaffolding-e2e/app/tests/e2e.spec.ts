/**
 * E2E test — opens the in-app TestRunner, clicks "Run All Tests",
 * waits for all tests to complete, and asserts zero failures.
 *
 * Prerequisites:
 *   1. merod running:  merod --home ~/.calimero/node1 run
 *   2. App running:    pnpm dev  (in /frontend)
 *   3. Run tests:      pnpm test
 *
 * Auth is handled automatically by global-setup.ts on the first run
 * and cached in tests/.auth/state.json for subsequent runs.
 * Credentials are read from E2E_USERNAME / E2E_PASSWORD in .env (default: admin / password).
 * To force re-authentication: pnpm run test:auth
 */

import { test, expect, Page } from "@playwright/test";

// Derived from the DOM, NOT hardcoded.
//
// This was `const TOTAL_TESTS = 95; // keep in sync with TestRunner.tsx` and it
// was not kept in sync — the runner is at 122. A hardcoded LOWER bound makes the
// wait succeed as soon as 95 of 122 tests have finished, so the spec could pass
// while 27 tests were still running and any of them still failing. A comment
// asking a human to keep two numbers in step is not a mechanism.

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
  // Wait until every rendered test has settled into pass or fail.
  //
  // Compared against the number of test elements actually PRESENT, so it cannot
  // drift from the TESTS array the way a hardcoded total did. `> 0` guards the
  // moment before the list renders, when both sides would be 0 and the wait
  // would return immediately.
  await page.waitForFunction(
    () => {
      const items = [...document.querySelectorAll("[data-testid^='test-'][data-status]")];
      if (items.length === 0) return false;
      const done = items.filter(
        (el) => el.getAttribute("data-status") === "pass" || el.getAttribute("data-status") === "fail",
      );
      return done.length === items.length;
    },
    null,
    { timeout: 180_000, polling: 500 },
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
        // Use div[style*=…] to skip the <span> elements (StatusDot + test name) that
        // also carry color:var(--color-error) on failure — those would cause a strict-mode
        // multi-match and textContent() would throw, silently falling back to "".
        const error = await el.locator("div[style*='color: var(--color-error)']").textContent().catch(() => "");
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
  "Authored Map",
  "Shared Storage",
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
