import { expect, type Page } from "@playwright/test";

import { readState } from "./global-setup";

/** Sign in to the suite's node the way the SSO callback does: tokens in the hash. */
export async function login(page: Page): Promise<void> {
  const s = readState();
  await page.addInitScript(
    ([key, url]) => window.localStorage.setItem(key, url),
    ["mero:node_url", s.nodeUrl] as const,
  );
  const params = new URLSearchParams({
    access_token: s.accessToken,
    refresh_token: s.refreshToken,
    node_url: s.nodeUrl,
  });
  await page.goto(`/#${params.toString()}`);
}

/**
 * Sign in and land inside a fresh audience of a fresh company, so a spec does
 * not depend on what another spec left on the shared node.
 */
export async function enterNewAudience(page: Page, label: string): Promise<void> {
  await login(page);
  await expect(page).toHaveURL(/\/companies$/, { timeout: 30_000 });
  await page.getByTestId("space-name-input").fill(`${label} ${Date.now()}`);
  await page.getByTestId("create-space").click();
  await expect(page).toHaveURL(/\/companies\/[^/]+$/, { timeout: 60_000 });
  await page.getByTestId("audience-name-input").fill("All investors");
  await page.getByTestId("create-audience").click();
  await expect(page).toHaveURL(/\/a$/, { timeout: 60_000 });
  await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible({ timeout: 30_000 });
}
