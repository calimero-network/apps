import { expect, test } from "@playwright/test";

// The unauthenticated shell — the state a cold CI run and a first visitor are
// both in. ci.yml's browser job has no opt-out: it runs `npx playwright test`
// for every changed app, so an app with no config fails outright, which is what
// this app was doing.
//
// Deliberately modest. This frontend is still on the pre-mero-js SDK and its
// contract calls are hand-written, so there is no honest way to assert real
// behaviour from here yet; what these do assert is that the shell mounts, tells
// the visitor what to do, and does not throw. That is worth having on its own —
// a bundle that fails to boot would otherwise reach a release.
test.describe("unauthenticated shell", () => {
  test("renders the connection prompt rather than an empty page", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /calimero connection required/i }),
    ).toBeVisible();
    await expect(page.getByText(/to access MeroSign/i)).toBeVisible();
    expect(errors, "an unhandled error escaped to the page").toEqual([]);
  });

  test("an unknown route still renders the shell", async ({ page }) => {
    // The router only mounts once authenticated, so an unknown path must fall
    // through to the same prompt rather than a blank screen.
    await page.goto("/does-not-exist");
    await expect(
      page.getByRole("heading", { name: /calimero connection required/i }),
    ).toBeVisible();
  });
});
