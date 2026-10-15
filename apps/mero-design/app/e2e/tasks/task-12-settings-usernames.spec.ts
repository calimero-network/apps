import { test, expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { TEST_IDENTITY } from "../fixtures/board";

/**
 * IMPORTANT.md item 12 — "In project settings we should also replace identityID's
 * with usernames we gave first time we join the project".
 *
 * The usernames are already in the contract (`get_members` / `update_member_username`).
 * Settings now fetches them and leads each row with the name; the raw identity stays
 * as a copyable code, which is what it is actually useful for.
 *
 * Driven from the boards rail: a board's ⋯ → Settings opens the shell's
 * settings panel on that board.
 */
const PROJECT = { contextId: "ctx-1", groupId: "abcd", name: "Board one", description: "", isPublic: false };

async function openProjectSettings(page: Page) {
  const calls: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("mero-tokens", JSON.stringify({
      access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LWlkZW50aXR5In0.sig",
      refresh_token: "r", expires_at: Date.now() + 3600000,
      node_origin: "http://localhost:2430", // mero-js ignores a bundle bound to no node
    }));
    localStorage.setItem("mero:node_url", "http://localhost:2430");
    localStorage.setItem("mero:application_id", "app-1");
  });
  await page.route("**/auth/validate", (r: Route) => r.fulfill({ status: 200 }));
  await page.route("**/events**", (r: Route) => r.abort());
  await page.route("**/sse**", (r: Route) => r.abort());
  await page.route("**/admin-api/**", (r: Route) =>
    r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        data: {
          subgroups: [{ groupId: PROJECT.groupId, alias: PROJECT.name }],
          contexts: [{ contextId: "ctx-1", applicationId: "app-1" }],
          identities: [TEST_IDENTITY],
          members: [{ identity: TEST_IDENTITY, role: "Admin" }],
        },
        // The member listing is read un-enveloped.
        members: [{ identity: TEST_IDENTITY, role: "Admin" }],
      }),
    }),
  );
  await page.route("**/jsonrpc", (route: Route) => {
    const body = route.request().postDataJSON() as { id?: number; params?: { method?: string } };
    const method = body?.params?.method ?? "";
    calls.push(method);
    let value: unknown = [];
    if (method === "get_members") value = [{ id: TEST_IDENTITY, username: "Tester", avatar: null, joinedAt: 1 }];
    else if (method === "list_roles") value = [{ member: TEST_IDENTITY, role: "admin" }];
    else if (method === "my_role") value = "admin";
    else if (method === "get_board") value = { name: "Board one", description: "", elementCount: 0, memberCount: 1 };
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(value)));
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: body?.id ?? 1, result: { output: bytes, logs: [] } }),
    });
  });
  await page.goto("/teams/team-1/projects");
  return calls;
}

async function openBoardSettings(page: Page) {
  await page.getByTestId(`board-menu-${PROJECT.contextId}`).click();
  await page.getByTestId(`board-settings-${PROJECT.contextId}`).click();
  await expect(page.getByTestId("settings-section-project")).toBeVisible();
}

test.describe("item 12: usernames in project settings", () => {
  test("the settings panel asks the contract for the roster", async ({ page }) => {
    const calls = await openProjectSettings(page);
    const before = calls.filter((c) => c === "get_members").length;
    await openBoardSettings(page);
    await expect.poll(() => calls.filter((c) => c === "get_members").length, { timeout: 15000 }).toBeGreaterThan(before);
  });

  test("get_members is fetched alongside list_roles, not instead of it", async ({ page }) => {
    const calls = await openProjectSettings(page);
    await openBoardSettings(page);
    await expect.poll(() => calls.includes("get_members") && calls.includes("list_roles"), { timeout: 15000 }).toBe(true);
  });

  test("the panel leads each row with the name", async ({ page }) => {
    await openProjectSettings(page);
    await openBoardSettings(page);
    await expect(page.getByTestId("settings-section-project")).toContainText("Tester");
  });
});
