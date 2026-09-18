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
//
// ⚠️ That explainer was then replaced again, by the fleet-wide landing template
// (scripts/landing/template). Its own contract — sections, badge, theme, FAQ —
// is asserted by the generated tests/landing.spec.ts; what stays here is the
// part that is specific to THIS app: the page mounts clean, names itself, and
// the way in is a button, because MeroSign has no /login route to link to.
test.describe("unauthenticated shell", () => {
  test("`/` explains the app before asking for a node", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Mero Sign" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What you can do" })).toBeVisible();

    // ⚠️ The explainer, the four steps and the FAQ now live on `/docs`. The
    // landing is three pages: `/` sells it, `/docs` explains it, `/preview`
    // shows it. Asserting them all on `/` was asserting the old shape.
    await page.goto("/docs");
    await expect(page.getByRole("heading", { name: "What this is" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How Calimero works" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "FAQ" })).toBeVisible();

    await page.goto("/");
    // A way in, twice over: the header and the hero. Buttons rather than links
    // because this app signs in through mero-react's modal, with no /login route.
    await expect(page.getByRole("button", { name: "Connect to node" })).toHaveCount(2);

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

  test("the explainer offers no navigation into screens you cannot open", async ({ page }) => {
    // ⚠️ There is no nav rail to check for any more — `Sidebar`, `MobileHeader`
    // and `MobileLayout` are gone, and with them the 280px rail that held two
    // links and a connect button that only ever appeared once you were already
    // connected. What must still hold is the property the old test was after.
    await page.goto("/");
    await expect(page.getByRole("link", { name: /^dashboard$/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^signatures$/i })).toHaveCount(0);
  });

  test("an unknown route renders a dead end, not a connection prompt", async ({ page }) => {
    // WAS: "an unknown route still renders the connection prompt" — the
    // unauthenticated catch-all rendered `CalimeroConnectionRequired` inside
    // `MobileLayout`, which told somebody who typed a wrong address that their
    // node was the problem. There is one catch-all now and it says what is
    // actually true. See `tests/routing.spec.ts` for the redirect-loop guards.
    await page.goto("/does-not-exist");
    await expect(page.getByTestId("not-found")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /that page does not exist/i }),
    ).toBeVisible();
  });
});
