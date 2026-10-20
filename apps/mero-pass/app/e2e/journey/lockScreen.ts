import { expect, type Page } from "@playwright/test";

// Every browser must protect its device key and make a recovery key before a
// vault opens (src/components/LockGate.tsx). The journeys seal it under a
// passphrase, since a headless browser has no authenticator to answer a
// passkey's PRF, and type back the recovery code the page shows.

export const JOURNEY_PASSPHRASE = "journey-device-passphrase";

/**
 * Take one step past whichever lock screen is up: protect a new or
 * unprotected key, make or confirm the recovery key, or unlock. Returns
 * whether it did anything, so a caller that polls can call it every round.
 */
export async function stepPastLock(page: Page): Promise<boolean> {
  if (await page.getByTestId("device-setup").isVisible().catch(() => false)) {
    const use = page.getByTestId("setup-use-passphrase");
    await page.getByTestId("setup-passphrase").fill(JOURNEY_PASSPHRASE);
    await page.getByTestId("setup-passphrase-repeat").fill(JOURNEY_PASSPHRASE);
    if (!(await use.isEnabled().catch(() => false))) return false;
    await use.click();
    return true;
  }
  if (await page.getByTestId("recovery-setup").isVisible().catch(() => false)) {
    const code = page.getByTestId("setup-recovery-code");
    if (await code.isVisible().catch(() => false)) {
      const shown = (await code.textContent())?.trim() ?? "";
      await page.getByTestId("setup-recovery-confirm").fill(shown.split("-").pop() ?? "");
      await page.getByTestId("setup-recovery-done").click();
      return true;
    }
    const create = page.getByTestId("setup-create-recovery");
    if (!(await create.isEnabled().catch(() => false))) return false;
    await create.click();
    return true;
  }
  const passphrase = page.getByTestId("unlock-passphrase");
  if (await passphrase.isVisible().catch(() => false)) {
    await passphrase.fill(JOURNEY_PASSPHRASE);
    await page.getByTestId("unlock").click();
    return true;
  }
  return false;
}

/** Step past the lock screens until `ready` shows. */
export async function passLockScreen(page: Page, ready: string, timeout = 120_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.getByTestId(ready).isVisible().catch(() => false)) return;
    await stepPastLock(page);
    await page.waitForTimeout(1_000);
  }
  await expect(page.getByTestId(ready)).toBeVisible({ timeout: 1_000 });
}
