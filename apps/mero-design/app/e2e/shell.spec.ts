import { test, expect } from "@playwright/test";
import { TEST_IDENTITY } from "./fixtures/board";
import { mockShellNode, twoTeams } from "./fixtures/shell";

/**
 * The app shell: one frame for every signed-in screen. Each test is a task a
 * user does, and the click count it used to take is in its name's comment.
 */

test.describe("resume where you left off", () => {
  test("/teams opens the board open last, when the node still lists it", async ({ page }) => {
    // Before: /teams → click team → click board (2 clicks after landing).
    await mockShellNode(page, {
      teams: twoTeams(),
      lastVisit: { team: "team-b", boards: { "team-b": "ctx-b1" } },
    });
    await page.goto("/teams");
    await expect(page).toHaveURL(/\/teams\/team-b\/projects\/ctx-b1$/);
    await expect(page.getByTestId("fabric-canvas")).toBeVisible();
    await expect(page.getByTestId("board-crumb")).toHaveText("Launch");
  });

  test("a remembered team the node no longer lists falls back to the first", async ({ page }) => {
    await mockShellNode(page, { teams: twoTeams(), lastVisit: { team: "team-gone" } });
    await page.goto("/teams");
    await expect(page).toHaveURL(/\/teams\/team-a\/projects$/);
    await expect(page.getByTestId("project-card-ctx-a1")).toBeVisible();
  });

  test("a remembered board that was deleted opens the team home instead", async ({ page }) => {
    await mockShellNode(page, {
      teams: twoTeams(),
      lastVisit: { team: "team-a", boards: { "team-a": "ctx-deleted" } },
    });
    await page.goto("/teams");
    await expect(page).toHaveURL(/\/teams\/team-a\/projects$/);
    await expect(page.getByTestId("project-card-ctx-a2")).toBeVisible();
  });

  test("opening a board is remembered for next time", async ({ page }) => {
    await mockShellNode(page, { teams: twoTeams() });
    await page.goto("/teams/team-a/projects/ctx-a2");
    await expect(page.getByTestId("fabric-canvas")).toBeVisible();
    await page.goto("/teams");
    await expect(page).toHaveURL(/\/teams\/team-a\/projects\/ctx-a2$/);
  });

  test("a link naming only a board finds its team (the desktop deep link)", async ({ page }) => {
    await mockShellNode(page, { teams: twoTeams() });
    await page.goto("/boards/ctx-b1");
    await expect(page).toHaveURL(/\/teams\/team-b\/projects\/ctx-b1$/);
    await expect(page.getByTestId("team-switcher")).toContainText("Marketing");
  });

  test("the old team URL still lands", async ({ page }) => {
    await mockShellNode(page, { teams: twoTeams() });
    await page.goto("/teams/team-a");
    await expect(page).toHaveURL(/\/teams\/team-a\/projects$/);
  });
});

test.describe("switching and creating", () => {
  test("another board is one click in the rail", async ({ page }) => {
    // Before: ← back to projects, then click the board (2 clicks, 2 page loads).
    await mockShellNode(page, { teams: twoTeams() });
    await page.goto("/teams/team-a/projects/ctx-a1");
    await expect(page.getByTestId("fabric-canvas")).toBeVisible();
    await page.getByTestId("rail-board-ctx-a2").click();
    await expect(page).toHaveURL(/\/projects\/ctx-a2$/);
    await expect(page.getByTestId("board-crumb")).toHaveText("Flyer");
    await expect(page.getByTestId("rail-board-ctx-a2")).toHaveAttribute("aria-current", "page");
  });

  test("another team is two clicks in the switcher, and resumes its board", async ({ page }) => {
    // Before: ← back, Teams, click team, click board (4 clicks).
    await mockShellNode(page, {
      teams: twoTeams(),
      lastVisit: { team: "team-a", boards: { "team-b": "ctx-b1" } },
    });
    await page.goto("/teams/team-a/projects/ctx-a1");
    await expect(page.getByTestId("fabric-canvas")).toBeVisible();
    await page.getByTestId("team-switcher").click();
    await page.getByTestId("team-option-team-b").click();
    await expect(page).toHaveURL(/\/teams\/team-b\/projects\/ctx-b1$/);
  });

  test("a new team opens as soon as it is created", async ({ page }) => {
    const node = await mockShellNode(page, { teams: twoTeams() });
    await page.goto("/teams/team-a/projects");
    await page.getByTestId("team-switcher").click();
    await page.getByTestId("new-team-btn").click();
    await page.getByTestId("new-team-input").fill("Research");
    await page.getByTestId("new-team-input").press("Enter");
    await expect(page).toHaveURL(/\/teams\/team-3\/projects$/);
    await expect(page.getByTestId("team-switcher")).toContainText("Research");
    await expect(page.getByTestId("empty-projects")).toBeVisible();
    expect(node.writes.filter((w) => w.path === "/namespaces")).toHaveLength(1);
  });

  test("a new board from the rail opens as soon as it is created", async ({ page }) => {
    await mockShellNode(page, { teams: twoTeams() });
    await page.goto("/teams/team-a/projects/ctx-a1");
    await expect(page.getByTestId("fabric-canvas")).toBeVisible();
    await page.getByTestId("new-board-btn").click();
    await page.getByTestId("rail-new-board-input").fill("Banner");
    await page.getByTestId("rail-create-board-btn").click();
    await expect(page).toHaveURL(/\/teams\/team-a\/projects\/ctx-new-\d+$/);
    await expect(page.getByTestId("board-crumb")).toHaveText("Banner");
  });

  test("a new board from the team home opens as soon as it is created", async ({ page }) => {
    await mockShellNode(page, { teams: twoTeams() });
    await page.goto("/teams/team-b/projects");
    await page.getByTestId("new-project-input").fill("Teaser");
    await page.getByTestId("create-project-btn").click();
    await expect(page).toHaveURL(/\/teams\/team-b\/projects\/ctx-new-\d+$/);
    await expect(page.getByTestId("fabric-canvas")).toBeVisible();
  });

  test("a first team on an empty node opens as soon as it is created", async ({ page }) => {
    await mockShellNode(page, { teams: [] });
    await page.goto("/teams");
    await expect(page.getByRole("heading", { name: "Start your first team" })).toBeVisible();
    await page.getByTestId("first-team-input").fill("Mine");
    await page.getByTestId("first-team-create").click();
    await expect(page).toHaveURL(/\/teams\/team-1\/projects$/);
  });

  test("deleting a board asks first, then leaves it", async ({ page }) => {
    const node = await mockShellNode(page, { teams: twoTeams() });
    await page.goto("/teams/team-a/projects/ctx-a1");
    await expect(page.getByTestId("fabric-canvas")).toBeVisible();
    await page.getByTestId("board-menu-ctx-a1").click();
    await page.getByTestId("board-delete-ctx-a1").click();
    await expect(page.getByTestId("confirm-dialog")).toContainText("Poster");
    await page.getByTestId("confirm-ok").click();
    await expect(page).toHaveURL(/\/teams\/team-a\/projects$/);
    await expect(page.getByTestId("rail-board-ctx-a1")).toHaveCount(0);
    // The context is tried first (the group delete only unregisters it) and
    // the node refuses it, as it does an app token; the subgroup still goes.
    const deletes = node.writes.filter((w) => w.method === "DELETE").map((w) => w.path);
    expect(deletes).toEqual(["/contexts/ctx-a1", "/groups/sg-a1"]);
  });

  test("a member who is not an admin is offered Leave, never Delete", async ({ page }) => {
    const teams = twoTeams();
    teams[0].members = [
      { identity: "a".repeat(64), role: "Admin", name: "Ann" },
      { identity: TEST_IDENTITY, role: "Member", name: "Tester" },
    ];
    const node = await mockShellNode(page, { teams });
    await page.goto("/teams/team-a/projects/ctx-a1?settings=team");
    await expect(page.getByTestId("leave-team-btn")).toBeVisible();
    await expect(page.getByTestId("delete-team-btn")).toHaveCount(0);
    await page.getByTestId("board-menu-ctx-a1").click();
    await expect(page.getByTestId("board-delete-ctx-a1")).toHaveCount(0);

    await page.getByTestId("leave-team-btn").click();
    await page.getByTestId("confirm-ok").click();
    await expect(page).toHaveURL(/\/teams$/);
    expect(node.writes.map((w) => `${w.method} ${w.path}`)).toContain("POST /namespaces/team-a/leave");
  });

  test("an admin is offered Delete, never Leave", async ({ page }) => {
    await mockShellNode(page, { teams: twoTeams() });
    await page.goto("/teams/team-a/projects/ctx-a1?settings=team");
    await expect(page.getByTestId("delete-team-btn")).toBeVisible();
    await expect(page.getByTestId("leave-team-btn")).toHaveCount(0);
    await page.getByTestId("settings-tab-board").click();
    await expect(page.getByTestId("delete-board-btn")).toBeVisible();
  });
});

test.describe("invite and settings, from anywhere", () => {
  test("Invite is one click to a minted link, and one more to copy it", async ({ page, context }) => {
    // Before: ← back, Invitations tab, Generate, Copy (4 clicks).
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const node = await mockShellNode(page, { teams: twoTeams() });
    await page.goto("/teams/team-a/projects/ctx-a1");
    await expect(page.getByTestId("fabric-canvas")).toBeVisible();
    await page.getByTestId("invite-btn").click();
    await expect(page.getByTestId("invite-token")).toBeVisible();
    expect(node.writes.filter((w) => w.path === "/namespaces/team-a/invite")).toHaveLength(1);
    await page.getByTestId("copy-invite").click();
    await expect(page.getByTestId("copy-invite")).toHaveText(/Copied/);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^https?:\/\//);
    expect(copied).toContain("invitation");
  });

  test("settings is a panel in the shell, addressed by the URL", async ({ page }) => {
    await mockShellNode(page, { teams: twoTeams() });
    await page.goto("/teams/team-a/projects/ctx-a1");
    await expect(page.getByTestId("fabric-canvas")).toBeVisible();
    await page.getByTestId("user-menu").click();
    await page.getByTestId("user-menu-settings").click();
    await expect(page).toHaveURL(/\?settings=team$/);
    await expect(page.getByTestId("settings-section-team")).toBeVisible();
    // The board is still there beside it.
    await expect(page.getByTestId("fabric-canvas")).toBeVisible();

    await page.getByTestId("settings-tab-board").click();
    await expect(page).toHaveURL(/\?settings=board$/);
    await expect(page.getByTestId("board-name-input")).toHaveValue("Poster");

    await page.reload();
    await expect(page.getByTestId("settings-section-project")).toBeVisible();
    await page.getByTestId("settings-close").click();
    await expect(page).toHaveURL(/\/projects\/ctx-a1$/);
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);
  });

  test("a member can be removed from the team, after a confirm", async ({ page }) => {
    const BEN = "b".repeat(64);
    const teams = twoTeams();
    teams[0].members = [
      { identity: TEST_IDENTITY, role: "Admin", name: "Tester" },
      { identity: BEN, role: "Member", name: "Ben" },
    ];
    const node = await mockShellNode(page, { teams });
    await page.goto("/teams/team-a/projects?settings=team");
    await page.getByTestId(`remove-member-${BEN}`).click();
    await page.getByTestId("confirm-ok").click();
    await expect(page.getByTestId(`remove-member-${BEN}`)).toHaveCount(0);
    expect(node.writes.find((w) => w.path === "/groups/team-a/members/remove")?.body).toEqual({ members: [BEN] });
  });

  test("Logout is in the account menu", async ({ page }) => {
    await mockShellNode(page, { teams: twoTeams() });
    await page.goto("/teams/team-a/projects");
    await page.getByTestId("user-menu").click();
    await page.getByTestId("logout-btn").click();
    await expect(page).toHaveURL(/\/$/);
  });
});
