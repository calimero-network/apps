import { test, expect } from "@playwright/test";

// Inject auth state so we land directly on the canvas
async function injectAuth(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const auth = {
      state: {
        nodeUrl: "http://localhost:2430",
        accessToken: "fake-access",
        refreshToken: "fake-refresh",
      },
      version: 0,
    };
    localStorage.setItem("merodesign-auth", JSON.stringify(auth));
  });
}

function mockRpc(page: import("@playwright/test").Page) {
  return page.route("**/jsonrpc", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    }),
  );
}

function mockSse(page: import("@playwright/test").Page) {
  return page.route("**/events**", (route) => route.abort());
}

test.describe("Canvas page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
    await mockRpc(page);
    await mockSse(page);
    await page.goto("/teams/team-1/projects/project-1");
    await expect(page.getByTestId("fabric-canvas")).toBeVisible({ timeout: 8000 });
  });

  test("renders toolbar with all drawing tools", async ({ page }) => {
    for (const id of ["select", "rect", "circle", "line", "arrow", "path", "text", "image"]) {
      await expect(page.getByTestId(`tool-${id}`)).toBeVisible();
    }
  });

  test("renders export buttons", async ({ page }) => {
    await expect(page.getByTestId("export-png")).toBeVisible();
    await expect(page.getByTestId("export-svg")).toBeVisible();
  });

  test("renders background color buttons", async ({ page }) => {
    await expect(page.getByTestId("bg-w")).toBeVisible();
    await expect(page.getByTestId("bg-g")).toBeVisible();
    await expect(page.getByTestId("bg-b")).toBeVisible();
  });

  test("clicking a tool activates it (rect)", async ({ page }) => {
    await page.getByTestId("tool-rect").click();
    await expect(page.getByTestId("tool-rect")).toHaveClass(/active/);
  });

  test("clicking a tool activates it (circle)", async ({ page }) => {
    await page.getByTestId("tool-circle").click();
    await expect(page.getByTestId("tool-circle")).toHaveClass(/active/);
  });

  test("background gray button applies .bgActive class", async ({ page }) => {
    await page.getByTestId("bg-g").click();
    await expect(page.getByTestId("bg-g")).toHaveClass(/bgActive/);
  });

  test("background black button applies .bgActive class", async ({ page }) => {
    await page.getByTestId("bg-b").click();
    await expect(page.getByTestId("bg-b")).toHaveClass(/bgActive/);
  });

  test("background white button is active by default", async ({ page }) => {
    await expect(page.getByTestId("bg-w")).toHaveClass(/bgActive/);
  });

  test("properties panel shows placeholder when nothing selected", async ({ page }) => {
    await expect(
      page.getByText("Select an element to edit its properties."),
    ).toBeVisible();
  });

  test("canvas element is present and has nonzero size", async ({ page }) => {
    const canvas = page.getByTestId("fabric-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);
  });
});

test.describe("Projects page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
    await page.route("**/admin-api/groups/**/contexts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { contexts: [] } }),
      }),
    );
    await page.goto("/teams/team-1/projects");
  });

  test("shows empty state", async ({ page }) => {
    await expect(page.getByTestId("empty-projects")).toBeVisible({ timeout: 5000 });
  });

  test("invite button opens modal", async ({ page }) => {
    await page.getByTestId("invite-button").click();
    await expect(page.getByTestId("invite-modal")).toBeVisible();
  });

  test("invite modal closes when clicking overlay", async ({ page }) => {
    await page.getByTestId("invite-button").click();
    await expect(page.getByTestId("invite-modal")).toBeVisible();
    await page.getByTestId("invite-modal-overlay").click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId("invite-modal")).not.toBeVisible();
  });

  test("shows projects when API returns them", async ({ page }) => {
    await page.route("**/admin-api/groups/**/contexts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            contexts: [
              { contextId: "ctx-1", name: "My Design", description: "", isPublic: false },
            ],
          },
        }),
      }),
    );
    await page.reload();
    await expect(page.getByTestId("project-card-ctx-1")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("My Design")).toBeVisible();
  });
});
