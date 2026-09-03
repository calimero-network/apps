import { expect, test } from "@playwright/test";

// The unauthenticated shell — the state a cold CI run and a first visitor are
// both in. ci.yml's browser job has no opt-out: it runs `npx playwright test`
// for every changed app, so an app with no config fails outright.
//
// Deliberately modest. This frontend is still on the pre-mero-js SDK and its
// contract calls are hand-written, so there is no honest way to assert real
// behaviour from here yet; what these assert is that the shell mounts, tells
// the visitor what the app IS and what to do, and does not throw.
//
// ⚠️ The first test used to expect "Calimero connection required" at `/`. That
// screen is still here — it is the right thing for losing a connection
// mid-session — but it is no longer the front door: `/` is now an explainer,
// because a gate that says what to click and never what MeroSign is left a
// first visitor with nothing to read.
test.describe("unauthenticated shell", () => {
  test("`/` explains the app before asking for a node", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /sign agreements without/i }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "What it does" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "FAQ" })).toBeVisible();
    // A way in, twice over: the header and the hero.
    await expect(page.getByRole("button", { name: /connect a node/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /get started/i })).toBeVisible();

    expect(errors, "an unhandled error escaped to the page").toEqual([]);
  });

  test("the explainer is fully visible at rest, with no scrolling", async ({ page }) => {
    // Regression guard, learned on mero-forum's equivalent page: a scroll-reveal
    // that parks sections at opacity 0 behind an IntersectionObserver renders
    // them as empty bands for anyone who does not scroll, and in every link
    // preview and thumbnail.
    await page.goto("/");
    const faint = await page.evaluate(() =>
      [...document.querySelectorAll("section, h2, h3, li")]
        .filter(
          (el) =>
            parseFloat(getComputedStyle(el).opacity) < 0.9 &&
            (el.textContent ?? "").trim().length > 10,
        )
        .map((el) => `${el.tagName}: ${(el.textContent ?? "").trim().slice(0, 40)}`),
    );
    expect(faint, "content parked below full opacity at rest").toEqual([]);
  });

  test("the explainer does not offer the app's nav rail", async ({ page }) => {
    // It renders outside MobileLayout on purpose: a signed-out visitor must not
    // be given navigation into screens they cannot open.
    await page.goto("/");
    await expect(page.getByRole("link", { name: /^dashboard$/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^signatures$/i })).toHaveCount(0);
  });

  test("an unknown route still renders the connection prompt", async ({ page }) => {
    // The router only mounts once authenticated, so an unknown path falls
    // through to the prompt rather than a blank screen — unchanged.
    await page.goto("/does-not-exist");
    await expect(
      page.getByRole("heading", { name: /calimero connection required/i }),
    ).toBeVisible();
    await expect(page.getByText(/to access MeroSign/i)).toBeVisible();
  });
});
