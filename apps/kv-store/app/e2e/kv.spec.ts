import { expect, test, type Page } from "@playwright/test";

/** A platform authenticator Chromium emulates, so the passkey ceremony is real. */
async function virtualPasskey(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test("sign up with a passkey, create a store, write and read it live", async ({ page }) => {
  await virtualPasskey(page);
  await page.goto("/");

  await page.getByTestId("name").fill("ada");
  await page.getByTestId("sign-up").click();
  await expect(page.getByTestId("account")).toContainText("Signed in as");

  await page.getByTestId("create-store").click();
  await expect(page.getByTestId("set")).toBeVisible();

  await page.getByTestId("key").fill("greeting");
  await page.getByTestId("value").fill("hello");
  await page.getByTestId("set").click();
  // The live event stream reloads the table.
  await expect(page.getByTestId("entries")).toContainText("greeting");
  await expect(page.getByTestId("events")).toContainText("Inserted");

  await page.getByTestId("read-key").fill("greeting");
  await page.getByTestId("get").click();
  await expect(page.getByTestId("read-result")).toHaveText('"hello"');

  // The session survives a reload; the same passkey signs back in after sign-out.
  await page.reload();
  await expect(page.getByTestId("entries")).toContainText("greeting");
  await page.getByTestId("sign-out").click();
  await page.getByTestId("sign-in").click();
  await expect(page.getByTestId("account")).toContainText("Signed in as");
  await expect(page.getByTestId("error")).toHaveCount(0);
});
