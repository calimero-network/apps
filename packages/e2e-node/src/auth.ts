import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USER } from "./rig";

export interface Credentials {
  username: string;
  password: string;
}

export const RIG_CREDENTIALS: Credentials = { username: ADMIN_USER, password: ADMIN_PASSWORD };

/** Where mero-js's `buildAuthLoginUrl` records a login this browser began, and the param it adds. */
const LOGIN_PENDING_KEY = "calimero.auth.login.pending";
const LOGIN_STATE_PARAM = "auth_state";

/**
 * Open `path` with `callback` (access_token, node_url, …) in the fragment, the
 * way the auth frontend sends a login back. From mero-js 25.3.2 (mero-js#271)
 * a page refuses callback tokens no login in it began, so this first records a
 * begun login exactly as `buildAuthLoginUrl` does and puts its state on the URL.
 */
export async function openAuthCallback(page: Page, path: string, callback: URLSearchParams): Promise<void> {
  const state = randomBytes(16).toString("hex");
  await page.addInitScript(
    ([key, begun, expiresAt]) => {
      let pending: Record<string, unknown> = {};
      try {
        pending = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
      } catch {
        /* unreadable: start over */
      }
      window.localStorage.setItem(key, JSON.stringify({ ...pending, [begun]: { expiresAt } }));
    },
    [LOGIN_PENDING_KEY, state, Date.now() + 10 * 60_000] as const,
  );
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set(LOGIN_STATE_PARAM, state);
  await page.goto(`${pathname}?${params.toString()}#${callback.toString()}`);
}

/** What the login modal showed, for a failure message: which state kept Connect disabled. */
async function describeLoginModal(page: Page): Promise<string> {
  const input = page.getByTestId("node-url-input");
  const parts = [
    `searching for nodes: ${(await page.getByTestId("node-discovering").count()) > 0}`,
    `url field shown: ${await input.isVisible().catch(() => false)}`,
    `url field value: ${JSON.stringify(await input.inputValue({ timeout: 500 }).catch(() => null))}`,
    `connect enabled: ${await page.getByTestId("connect-button").isEnabled().catch(() => false)}`,
  ];
  return parts.join(", ");
}

export async function chooseNodeInLoginModal(page: Page, nodeUrl: string): Promise<void> {
  const input = page.getByTestId("node-url-input");
  const custom = page.getByTestId("node-option-custom");
  const connect = page.getByTestId("connect-button");
  await expect(connect).toBeVisible({ timeout: 20_000 });
  // The modal's first frame has no search running yet, so "no search shown"
  // can be true before the local-node search has even started. And the
  // modal can be mounted again (empty URL) after it is first filled. Two CI
  // runs (mero-crm, mero-kombat) failed on Connect staying disabled for 20s
  // with nothing to say which. Fill until Connect takes it, re-filling
  // whatever the modal lost, and say what it showed if it never does.
  await expect(async () => {
    await expect(page.getByTestId("node-discovering")).toHaveCount(0);
    if (!(await input.isVisible()) && (await custom.isVisible())) await custom.click();
    if ((await input.inputValue({ timeout: 1_000 })) !== nodeUrl) await input.fill(nodeUrl);
    await expect(connect).toBeEnabled({ timeout: 1_000 });
  }, "the login modal takes the node URL and enables Connect")
    .toPass({ timeout: 40_000, intervals: [250, 500, 1_000] })
    .catch(async (err: unknown) => {
      throw new Error(`${err instanceof Error ? err.message : String(err)}\nlogin modal: ${await describeLoginModal(page)}`);
    });
  await connect.click();
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
