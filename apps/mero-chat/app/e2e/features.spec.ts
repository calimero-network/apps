/**
 * The core user journey, through the real UI, against a REAL merod node.
 *
 *   create a workspace → pick a name → create a PUBLIC channel → send a message
 *   → create a PRIVATE channel → send a message → reload → both are still there
 *
 * Two of these steps shipped broken while CI was green, because every browser
 * test answered the node from `page.route` mocks: namespace create sent
 * `upgradePolicy` (#210) and channel create sent `protocol` (#212), and core
 * refuses both with a 400. Nothing here is mocked. The node is booted by
 * e2e/real-node/global-setup.ts (`pnpm test:e2e:ci`).
 *
 * Beyond each step's own assertion, the test fails if ANY request to the node
 * answers 4xx/5xx — a refused body is exactly that, and it can hide behind a UI
 * that swallows the error.
 */
import { test, expect, type Page, type Response } from "@playwright/test";
import { getEnv, envAvailable } from "./helpers/rpc-client";
import { browserAuthAvailable, injectRealTokens } from "./helpers/node-client";

test.describe.configure({ mode: "serial" });

function requireNode() {
  test.skip(!envAvailable() || !browserAuthAvailable(), "needs the real node from e2e/real-node/global-setup.ts");
}

/** Every node response that failed, with the body that explains why. */
function watchNode(page: Page, nodeUrl: string) {
  const failures: string[] = [];
  page.on("response", async (res: Response) => {
    if (!res.url().startsWith(nodeUrl) || res.status() < 400) return;
    let body = "";
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      /* body gone */
    }
    failures.push(`${res.request().method()} ${new URL(res.url()).pathname} -> ${res.status()} ${body}`);
  });
  return failures;
}

async function openAsFreshUser(page: Page) {
  const env = getEnv();
  await injectRealTokens(page, {
    nodeUrl: env.nodeUrl,
    accessToken: env.accessToken,
    refreshToken: env.refreshToken,
  });
  await page.goto("/login");
}

async function createChannel(page: Page, name: string, visibility: "Public" | "Private") {
  await page.getByRole("button", { name: "Create channel" }).first().click();
  await page.getByPlaceholder("# channel name").fill(name);
  await page.getByRole("button", { name: visibility, exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  // The popup closes on success; on failure it stays open with the error.
  await expect(page.getByPlaceholder("# channel name")).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

async function sendMessage(page: Page, text: string) {
  const editor = page.locator(".ProseMirror").first();
  await editor.waitFor({ timeout: 20_000 });
  await editor.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect(page.locator(".msg-content").filter({ hasText: text }).first()).toBeVisible({ timeout: 20_000 });
}

test.describe("Real node: workspace, channels and messages", () => {
  test.beforeEach(requireNode);

  test("create a workspace, a public and a private channel, and message in both", async ({ page }) => {
    test.setTimeout(180_000);
    const env = getEnv();
    const failures = watchNode(page, env.nodeUrl);
    const stamp = Date.now().toString(36);
    const workspace = `Team ${stamp}`;
    const pub = `pub-${stamp}`;
    const priv = `priv-${stamp}`;

    await openAsFreshUser(page);

    // The node already holds the seeded workspace, so the popup opens on the
    // selector. Create a second one through the UI.
    await page.getByText("+ Create new workspace").click({ timeout: 30_000 });
    await page.getByPlaceholder("e.g. My Team").fill(workspace);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await page.getByPlaceholder("e.g. Alice").fill("Alice", { timeout: 30_000 });
    await page.getByRole("button", { name: /^Join/ }).click();

    await createChannel(page, pub, "Public");
    await sendMessage(page, `hello public ${stamp}`);

    await createChannel(page, priv, "Private");
    await sendMessage(page, `hello private ${stamp}`);

    // Persistence: the messages come back from the node, not from React state.
    await page.reload();
    await page.getByText(pub, { exact: true }).first().click({ timeout: 30_000 });
    await expect(page.locator(".msg-content").filter({ hasText: `hello public ${stamp}` }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByText(priv, { exact: true }).first().click();
    await expect(page.locator(".msg-content").filter({ hasText: `hello private ${stamp}` }).first()).toBeVisible({
      timeout: 20_000,
    });

    expect(failures, "node requests that failed").toEqual([]);
  });
});
