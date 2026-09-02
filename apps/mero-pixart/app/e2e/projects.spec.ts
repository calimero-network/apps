import { test, expect } from "@playwright/test";
import { injectAuth, mockNode } from "./support/mocks";

// The projects page: the empty state, the New Project modal (presets, custom
// sizes, validation) and the invitation tab. The showcase starter row is covered
// in showcase.spec.ts.

test.describe("Projects page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
    await mockNode(page);
    await page.route("**/admin-api/namespaces/**", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ data: { groupId: "sub-1" } }),
    }));
    await page.goto("/teams/team-1/projects");
  });

  test("shows an empty state with a call to action", async ({ page }) => {
    await expect(page.getByTestId("empty-projects")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create your first project" })).toBeVisible();
  });

  test("opens the New Project modal from the header", async ({ page }) => {
    await page.getByTestId("open-create-modal").click();
    await expect(page.getByTestId("create-modal")).toBeVisible();
    await expect(page.getByTestId("new-project-input")).toBeFocused();
  });

  test("offers the canvas presets and defaults to HD", async ({ page }) => {
    await page.getByTestId("open-create-modal").click();
    for (const size of ["1920x1080", "1280x720", "1080x1080", "800x600"]) {
      await expect(page.getByTestId(`preset-${size}`)).toBeVisible();
    }
    await expect(page.getByTestId("preset-custom")).toBeVisible();
  });

  test("a custom size reveals width and height fields", async ({ page }) => {
    await page.getByTestId("open-create-modal").click();
    await expect(page.getByTestId("custom-width")).toHaveCount(0);
    await page.getByTestId("preset-custom").click();
    await expect(page.getByTestId("custom-width")).toBeVisible();
    await expect(page.getByTestId("custom-height")).toBeVisible();
  });

  test("refuses to create a project without a name", async ({ page }) => {
    await page.getByTestId("open-create-modal").click();
    await expect(page.getByTestId("create-project-btn")).toBeDisabled();
    await page.getByTestId("new-project-input").fill("Poster");
    await expect(page.getByTestId("create-project-btn")).toBeEnabled();
  });

  test("rejects an out-of-range custom canvas", async ({ page }) => {
    await page.getByTestId("open-create-modal").click();
    await page.getByTestId("new-project-input").fill("Huge");
    await page.getByTestId("preset-custom").click();
    await page.getByTestId("custom-width").fill("99999");
    await page.getByTestId("create-project-btn").click();
    await expect(page.getByText(/valid canvas size/)).toBeVisible();
  });

  test("creating a project posts a subgroup and a context", async ({ page }) => {
    const posted: string[] = [];
    await page.route("**/admin-api/contexts", (route) => {
      if (route.request().method() === "POST") {
        posted.push("context");
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ data: { contextId: "ctx-new" } }),
        });
      }
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ data: { contexts: [] } }),
      });
    });

    await page.getByTestId("open-create-modal").click();
    await page.getByTestId("new-project-input").fill("Poster");
    await page.getByTestId("create-project-btn").click();
    await expect(page.getByTestId("create-modal")).toHaveCount(0);
    expect(posted).toContain("context");
  });

  test("the invitations tab generates and copies a token", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Invitations" }).click();
    await page.getByTestId("generate-invite").click();
    await expect(page.getByTestId("invite-token")).toBeVisible();
    await page.getByTestId("copy-invite").click();
    await expect(page.getByTestId("invite-copying")).toBeVisible();
  });

  test("back navigates to the teams list", async ({ page }) => {
    await page.getByRole("button", { name: "← Teams" }).click();
    await expect(page).toHaveURL(/\/teams$/);
  });
});
