import { expect, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USER } from "./rig";

export interface Credentials {
  username: string;
  password: string;
}

export const RIG_CREDENTIALS: Credentials = { username: ADMIN_USER, password: ADMIN_PASSWORD };

export async function chooseNodeInLoginModal(page: Page, nodeUrl: string): Promise<void> {
  const input = page.getByTestId("node-url-input");
  const custom = page.getByTestId("node-option-custom");
  await expect(page.getByTestId("connect-button")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("node-discovering")).toHaveCount(0, { timeout: 20_000 });
  if (!(await input.isVisible()) && (await custom.isVisible())) await custom.click();
  await input.fill(nodeUrl);
  await expect(page.getByTestId("connect-button")).toBeEnabled();
  await page.getByTestId("connect-button").click();
}

export async function completeNodeLogin(
  page: Page,
  nodeUrl: string,
  creds: Credentials = RIG_CREDENTIALS,
): Promise<void> {
  const nodeOrigin = new URL(nodeUrl).origin;
  await page.waitForURL((u) => u.origin === nodeOrigin, { timeout: 30_000 });

  const username = page.getByPlaceholder("Enter your username");
  const provider = page.getByText("Username/Password");
  await expect(username.or(provider).first()).toBeVisible({ timeout: 30_000 });
  if (!(await username.isVisible())) await provider.click();
  await username.fill(creds.username);
  await page.getByPlaceholder("Enter your password").fill(creds.password);
  await page.getByRole("button", { name: "Sign In" }).click();

  const leftNode = page.waitForURL((u) => u.origin !== nodeOrigin, { timeout: 60_000 });
  const steps = [
    page.getByRole("button", { name: "Continue", exact: true }),
    page.getByRole("button", { name: "Install & Continue" }),
    page.getByRole("button", { name: "Approve Permissions" }),
    page.getByRole("button", { name: "Generate Token" }),
  ];
  const deadline = Date.now() + 60_000;
  while (new URL(page.url()).origin === nodeOrigin && Date.now() < deadline) {
    const install = steps[1]!;
    if (await install.isVisible().catch(() => false)) {
      throw new Error(
        "the auth page offered to install the app from the registry, so the node did not see the dev bundle the rig installed",
      );
    }
    let clicked = false;
    for (const step of steps) {
      if (await step.isVisible().catch(() => false)) {
        if (await step.isEnabled().catch(() => false)) {
          await step.click().catch(() => undefined);
          clicked = true;
        }
        break;
      }
    }
    if (!clicked) {
      const error = page.getByText(/not allowed|failed|error/i).first();
      if (await error.isVisible().catch(() => false)) {
        throw new Error(`the auth page reported: ${await error.innerText()}`);
      }
    }
    await page.waitForTimeout(250);
  }
  await leftNode;
}

export async function loginWithModal(page: Page, nodeUrl: string, creds?: Credentials): Promise<void> {
  await chooseNodeInLoginModal(page, nodeUrl);
  await completeNodeLogin(page, nodeUrl, creds);
}
