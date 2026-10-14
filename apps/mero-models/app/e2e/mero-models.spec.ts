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

  test("models with polygon tools, and the node keeps the cage and its modifiers", async ({ page, browser }) => {
    const errors = watchForErrors(page);
    await login(page);
    await waitForStudio(page);

    await page.getByTestId("add-cube").click();
    const name = "Bevelled block";
    await page.getByLabel("Object name").fill(name);
    await page.getByLabel("Object name").press("Enter");
    await expect(outlinerRow(page, name)).toHaveCount(1);
    const canvas = page.locator("canvas.viewport-canvas");
    await canvas.focus();
    // Tab turns the primitive into a polygon cage — six quads on eight
    // vertices, its UV seams kept per face corner — and enters edit mode.
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("edit-selection")).toContainText("0 of 8 vertices selected");
    await expect(page.getByTestId("cage-stats")).toContainText("8 vertices · 6 faces · 12 triangles");

    // Edge mode, every edge, Ctrl+B: a chamfer on each edge and a patch at each corner.
    await page.keyboard.press("2");
    await page.keyboard.press("a");
    await page.keyboard.press("Control+b");
    await expect(page.getByTestId("cage-stats")).toContainText("24 vertices · 26 faces");
    await expect(page.getByTestId("op-panel")).toContainText("Bevel");

    // Face mode carries the selection over: the bevel left every vertex
    // selected, so every face is. E on a closed region has no border to grow
    // walls from, so it is pushed out along its normals — the same faces, larger.
    await page.keyboard.press("3");
    await expect(page.getByTestId("edit-selection")).toContainText("26 of 26 faces selected");
    await page.keyboard.press("e");
    await expect(page.getByTestId("cage-stats")).toContainText("26 faces");

    // Back in object mode: a subdivision surface on top, the bevel holding its edges.
    await page.keyboard.press("Tab");
    await page.getByTestId("add-modifier").selectOption("subdivision");
    await expect(page.getByTestId("modifier-subdivision")).toBeVisible();
    await expect(page.locator(".save-state")).toHaveText("Saved to your node", { timeout: 20_000 });

    // A fresh page reads the cage and the stack back from the node.
    const other = await freshView(browser);
    await outlinerRow(other, name).click();
    await expect(other.getByTestId("modifier-subdivision")).toBeVisible({ timeout: 30_000 });
    await other.locator("canvas.viewport-canvas").focus();
    await other.keyboard.press("Tab");
    await expect(other.getByTestId("cage-stats")).toContainText("24 vertices · 26 faces");

    errors.assertClean();
  });

  test("unwraps a mesh along its seams, and the node keeps the layout", async ({ page, browser }) => {
    const errors = watchForErrors(page);
    await login(page);
    await waitForStudio(page);

    await page.getByTestId("add-cylinder").click();
    const name = "Unwrapped pipe";
    await page.getByLabel("Object name").fill(name);
    await page.getByLabel("Object name").press("Enter");
    await expect(outlinerRow(page, name)).toHaveCount(1);
    await page.locator("canvas.viewport-canvas").focus();
    // A primitive's cage keeps its UV seams as marked seams: down the side, round the caps.
    await page.keyboard.press("Tab");
    await page.getByTestId("toggle-uv-editor").click();
    await expect(page.getByTestId("uv-editor")).toBeVisible();
    await page.keyboard.press("u");
    await expect(page.getByTestId("uv-stats")).toContainText("3 islands");
    await expect(page.getByTestId("op-panel")).toContainText("Unwrap");
    await page.getByTestId("toggle-checker").click();

    // Smart project needs no seams: it splits the side by facing.
    await page.getByRole("button", { name: "Smart project" }).first().click();
    await expect(page.getByTestId("uv-stats")).not.toContainText("3 islands");
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("uv-stats")).toContainText("3 islands");
    await expect(page.locator(".save-state")).toHaveText("Saved to your node", { timeout: 20_000 });

    // A fresh page reads the same layout back from the node.
    const other = await freshView(browser);
    await outlinerRow(other, name).click();
    await other.getByTestId("toggle-uv-editor").click();
    await expect(other.getByTestId("uv-stats")).toContainText("3 islands", { timeout: 30_000 });

    errors.assertClean();
  });

  test("loads the example assets, built from the modelling tools", async ({ page, browser }) => {
    const errors = watchForErrors(page);
    await login(page);
    await waitForStudio(page);
    await page.getByRole("menuitem", { name: "Add" }).click();
    await page.getByRole("menuitem", { name: "Examples" }).hover();
    await page.getByRole("menuitem", { name: /Showcase/ }).click();
    for (const group of ["Sci-fi supply crate", "Fuel drum", "Sword", "Corridor kit", "Rock and tree"]) {
      await expect(outlinerRow(page, group)).toHaveCount(1);
    }
    await expect(page.locator(".save-state")).toHaveText("Saved to your node", { timeout: 60_000 });

    const other = await freshView(browser);
    await expect(outlinerRow(other, "Corridor kit")).toHaveCount(1);
    await outlinerRow(other, "Wall panel").click();
    await expect(other.getByTestId("modifier-array")).toBeVisible({ timeout: 30_000 });

    errors.assertClean();
  });

  test("a mesh is a versioned blob, can be checked out and textured, and another page downloads it", async ({ page, browser }) => {
    const errors = watchForErrors(page);
    await login(page);
    await waitForStudio(page);

    await page.getByTestId("add-cube").click();
    await page.getByLabel("Object name").fill("Hero crate");
    await page.getByLabel("Object name").press("Enter");
    await expect(outlinerRow(page, "Hero crate")).toHaveCount(1);

    // Tab converts the cube into a mesh: its vertices go up as a blob and the
    // contract records version 1.
    await page.locator("canvas.viewport-canvas").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /History · 1 version$/ })).toBeVisible({ timeout: 20_000 });

    // Check it out.
    await page.getByTestId("check-out").click();
    await expect(page.getByTestId("lock-mine")).toBeVisible({ timeout: 20_000 });
    await expect(outlinerRow(page, "Hero crate").getByTestId("outliner-lock")).toBeVisible();

    // A base-colour texture, uploaded through the material slot.
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("texture-slots").getByRole("button", { name: "Upload…" }).first().click();
    await (await chooser).setFiles("public/icon-192.png");
    const slot = page.getByLabel("Base colour texture");
    await expect(slot.locator("option:checked")).toHaveText(/icon-192 · 192×192/, { timeout: 20_000 });
    await expect(page.locator(".save-state")).toHaveText("Saved to your node", { timeout: 20_000 });

    // A fresh page has nothing cached in memory: it reads the references and
    // downloads the mesh blob from the node.
    const other = await freshView(browser);
    await outlinerRow(other, "Hero crate").click();
    await expect(other.getByTestId("mesh-status")).toHaveCount(0, { timeout: 20_000 });
    await expect(other.getByText(/Mesh · \d+ vertices · 12 triangles/)).toBeVisible();
    await expect(other.getByLabel("Base colour texture").locator("option:checked")).toHaveText(/icon-192/);
    await expect(other.getByTestId("lock-mine")).toBeVisible();

    // Check it back in.
    await page.getByTestId("check-in").click();
    await expect(outlinerRow(page, "Hero crate").getByTestId("outliner-lock")).toHaveCount(0, { timeout: 20_000 });

    errors.assertClean();
  });
});
