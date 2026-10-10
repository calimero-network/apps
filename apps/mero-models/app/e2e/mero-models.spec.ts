/**
 * The studio, against a real node.
 *
 * Everything goes through the UI — the toolbar, the outliner, the properties
 * panel, the keyboard — and every claim is checked a second time from a fresh
 * page, which reads the scene back from the node. A frontend that only showed
 * its own optimistic edits would pass the first half of each step and fail the
 * second.
 *
 * One node: the two-node story (an edit replicating, a viewer refused on every
 * node) is logic/workflows/edit-a-scene.yml.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { login, outlinerRow, waitForStudio, watchForErrors } from "./helpers";

/** A second, independent page on the same scene — what the node really holds. */
async function freshView(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page);
  await waitForStudio(page);
  return page;
}

test.describe("Mero Models", () => {
  test("builds a scene through the UI and the node keeps it", async ({ page, browser }) => {
    const errors = watchForErrors(page);
    await login(page);
    await waitForStudio(page);
    await expect(page.locator("canvas.viewport-canvas")).toBeVisible();

    // ── add ──────────────────────────────────────────────────────────────
    await page.getByTestId("add-cube").click();
    await expect(outlinerRow(page, "Cube")).toHaveCount(1);
    await expect(page.getByLabel("Object name")).toHaveValue("Cube");

    // ── rename through the properties panel ──────────────────────────────
    await page.getByLabel("Object name").fill("Body");
    await page.getByLabel("Object name").press("Enter");
    await expect(outlinerRow(page, "Body")).toHaveCount(1);

    await page.getByTestId("add-sphere").click();
    await expect(outlinerRow(page, "Sphere")).toHaveCount(1);
    await expect(page.getByTestId("notice")).not.toHaveClass(/error/);

    // ── delete and undo, from the keyboard ───────────────────────────────
    await outlinerRow(page, "Body").click();
    await page.locator("canvas.viewport-canvas").focus();
    await page.keyboard.press("x");
    await expect(outlinerRow(page, "Body")).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await expect(outlinerRow(page, "Body")).toHaveCount(1);

    // ── group the two ────────────────────────────────────────────────────
    await outlinerRow(page, "Body").click();
    await outlinerRow(page, "Sphere").click({ modifiers: ["Control"] });
    await page.locator("canvas.viewport-canvas").focus();
    await page.keyboard.press("Control+g");
    await expect(outlinerRow(page, "Group")).toHaveCount(1);
    await expect(page.getByTestId("save-state").or(page.locator(".save-state"))).toHaveText("Saved to your node", { timeout: 20_000 });

    // ── the node has it ──────────────────────────────────────────────────
    const other = await freshView(browser);
    await expect(outlinerRow(other, "Group")).toHaveCount(1, { timeout: 20_000 });
    await expect(outlinerRow(other, "Body")).toHaveCount(1);
    await expect(outlinerRow(other, "Sphere")).toHaveCount(1);
    // The hierarchy came back too: both sit one level inside the group.
    const indent = async (p: Page, name: string) =>
      Number.parseInt(await outlinerRow(p, name).evaluate((el) => (el as HTMLElement).style.paddingLeft), 10);
    expect(await indent(other, "Body")).toBeGreaterThan(await indent(other, "Group"));
    expect(await indent(other, "Sphere")).toBeGreaterThan(await indent(other, "Group"));

    errors.assertClean();
  });

  test("edits a primitive's vertices in edit mode", async ({ page }) => {
    const errors = watchForErrors(page);
    await login(page);
    await waitForStudio(page);

    await page.getByTestId("add-cube").click();
    const rows = page.getByTestId("outliner-row");
    await expect(rows.last()).toBeVisible();
    await page.locator("canvas.viewport-canvas").focus();
    // Tab converts the primitive into an editable mesh and enters edit mode.
    await page.keyboard.press("Tab");
    await expect(page.getByText(/vertices selected/)).toBeVisible();
    await page.keyboard.press("a");
    await expect(page.getByText(/^8 of 8 vertices selected/)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.locator(".panel-sub").first()).toContainText("Mesh");

    errors.assertClean();
  });
});
