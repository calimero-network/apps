import { expect, test, type Page } from "@playwright/test";
import { RelayClient, createMemoryNonceSource } from "@calimero-network/mero-js";
import { btn, login, state, waitForTeam } from "./helpers";

/**
 * The whole path a form takes, against a real merod with a real Mero CRM
 * pipeline beside it:
 *
 *   the team builds a form from a template and adds a question
 *   → a teammate enters a response by hand from the preview
 *   → an admin issues a form key, and a "website" answers with ONLY that key,
 *     by delegated execution, the way calimero-network/landing's
 *     api/contact.ts does (here the node itself is the relay)
 *   → the responses read back, with a summary of the choice question
 *   → the form is linked to the CRM pipeline, and one response is sent there:
 *     a contact and a deal appear in Mero CRM's own state
 *   → revoking the key stops that website.
 *
 * One test on purpose: each step needs the state the last one left.
 */

/** Calls a contract method on this node as the admin, the way the app's client does. */
async function call<T>(contextId: string, method: string, argsJson: unknown = {}): Promise<T> {
  const s = state();
  const resp = await fetch(`${s.nodeUrl}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.accessToken}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "execute", params: { contextId, method, argsJson } }),
  });
  const body = await resp.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return (body.result?.output ?? body.result) as T;
}

/** The five values the app shows once, parsed out of its env block. */
async function issueKey(page: Page, label: string) {
  await page.getByLabel("form key label").fill(label);
  await btn(page, "Create form key").click();
  const env = await page.getByTestId("issued-key").locator("pre").textContent({ timeout: 60_000 });
  const vars = Object.fromEntries(
    (env ?? "").split("\n").map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
  ) as Record<string, string>;
  expect(Object.keys(vars).sort()).toEqual([
    "CALIMERO_CONTEXT_ID",
    "CALIMERO_FORM_ACCOUNT",
    "CALIMERO_FORM_CREDENTIAL",
    "CALIMERO_FORM_DEVICE_SECRET",
    "CALIMERO_FORM_ID",
  ]);
  return vars;
}

/** What the website's backend does: sign a warrant for submit_response and hand it to a relay. */
function websiteBackend(vars: Record<string, string>) {
  const relay = new RelayClient({
    relayUrl: state().nodeUrl,
    authorAccount: vars["CALIMERO_FORM_ACCOUNT"]!,
    authorProof: vars["CALIMERO_FORM_CREDENTIAL"]!,
    deviceSecret: vars["CALIMERO_FORM_DEVICE_SECRET"]!,
    nonces: createMemoryNonceSource(Date.now()),
  });
  return (answers: Record<string, string[]>) =>
    relay.execute<string>(vars["CALIMERO_CONTEXT_ID"]!, "submit_response", {
      form_id: vars["CALIMERO_FORM_ID"]!,
      answers: Object.entries(answers).map(([field_id, values]) => ({ field_id, values })),
      source: "/contact/",
    });
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name });

test("a form collects responses from a website and by hand, and one goes to the CRM", async ({ page }) => {
  test.setTimeout(180_000);
  page.on("dialog", (d) => void d.accept());
  await login(page);
  await waitForTeam(page);
  await expect(page.getByText("No forms yet")).toBeVisible();

  // ── build: a template, plus a question of our own ────────────────────────
  await page.getByRole("button", { name: /Contact us/ }).click();
  await expect(page.getByLabel("form title")).toHaveValue("Contact us");
  await page.getByRole("button", { name: "Multiple choice", exact: true }).click();
  await page.getByLabel("question 5 label").fill("Topic");
  await page.getByLabel("question 5 option 1").fill("Cloud");
  await page.getByLabel("question 5 option 2").fill("Desktop");
  await page.getByLabel("question 5 required").check();
  await btn(page, "Save form").click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  // A saved question's id is fixed: a website sends answers under it.
  await expect(page.getByTestId("question-4").locator("code")).toHaveText("topic");

  // ── enter one by hand ────────────────────────────────────────────────────
  await tab(page, "Preview").click();
  await page.getByLabel("Name", { exact: true }).fill("Grace Hopper");
  await page.getByLabel("Email", { exact: true }).fill("grace@example.com");
  await page.getByLabel("Message", { exact: true }).fill("Met at the conference.");
  await btn(page, "Submit response").click();
  await expect(page.getByText("Still needed: Topic")).toBeVisible();
  await page.getByRole("radio", { name: "Desktop" }).check();
  await btn(page, "Submit response").click();
  await expect(page.getByRole("status")).toHaveText("Response saved.");

  // ── connect a website ────────────────────────────────────────────────────
  await tab(page, "Connect").click();
  const vars = await issueKey(page, "calimero.network contact page");
  expect(vars["CALIMERO_CONTEXT_ID"]).toBe(state().contextId);
  await btn(page, "Done").click();
  const relay = page.getByTestId("node-relay");
  await relay.getByRole("button", { name: "Let this node write for form keys" }).click();
  await expect(relay).toContainText("This node can write for form keys", { timeout: 30_000 });

  const submit = websiteBackend(vars);
  // The contract checks every answer: a topic that is not an option is refused.
  await expect(
    submit({ name: ["Ada"], email: ["ada@example.com"], message: ["Hi"], topic: ["Mobile"] }),
  ).rejects.toThrow();
  const sent = await submit({
    name: ["Ada Lovelace"],
    email: ["ada@example.com"],
    company: ["Analytical Engines"],
    message: ["We'd like to run a sealed node."],
    topic: ["Cloud"],
  });
  expect(sent.returns).toMatch(/^[0-9a-f]{32}$/);

  // ── read them back ───────────────────────────────────────────────────────
  await tab(page, "Responses").click();
  const rows = page.locator(".response-row");
  await expect(rows).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator(".summary-q", { hasText: "Topic" })).toContainText("1 · 50%");
  await rows.filter({ hasText: "Ada Lovelace" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel).toContainText("We'd like to run a sealed node.");
  await expect(panel).toContainText("/contact/");
  await expect(panel.getByRole("button", { name: "Set it up" })).toBeVisible();
  await page.getByRole("button", { name: "close" }).click();

  // ── link the CRM pipeline ────────────────────────────────────────────────
  await tab(page, "Connect").click();
  const crm = page.getByTestId("crm-settings");
  // The one pipeline on this node is chosen, and the questions are matched.
  await expect(crm.getByLabel("crm pipeline")).toHaveValue(state().crmContextId, { timeout: 30_000 });
  await expect(crm.getByLabel("crm contact name")).toHaveValue("name");
  await expect(crm.getByLabel("crm email")).toHaveValue("email");
  await expect(crm.getByLabel("crm organization")).toHaveValue("company");
  await crm.getByRole("button", { name: "Connect to CRM" }).click();
  await expect(crm.getByText("Saved")).toBeVisible();

  // ── send one ─────────────────────────────────────────────────────────────
  await tab(page, "Responses").click();
  await rows.filter({ hasText: "Ada Lovelace" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send to CRM" }).click();
  await expect(page.getByTestId("sent-to-crm")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "close" }).click();
  await expect(rows.filter({ hasText: "Ada Lovelace" })).toContainText("In CRM");

  // It is in Mero CRM's own state, not just marked here.
  const deals = await call<{ title: string; organization: string; source: string; contact_id: string | null }[]>(
    state().crmContextId,
    "list_deals",
    { status: null, stage_id: null, owner: null },
  );
  expect(deals).toHaveLength(1);
  expect(deals[0]).toMatchObject({
    title: "Ada Lovelace · Analytical Engines",
    organization: "Analytical Engines",
    source: "Mero Forms · Contact us",
  });
  const contacts = await call<{ id: string; name: string; email: string }[]>(state().crmContextId, "list_contacts");
  expect(contacts).toEqual([expect.objectContaining({ name: "Ada Lovelace", email: "ada@example.com" })]);
  expect(deals[0]!.contact_id).toBe(contacts[0]!.id);

  // ── it is the contract's state, not the page's ───────────────────────────
  await page.reload();
  await waitForTeam(page);
  await expect(page.locator(".response-row")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator(".response-row", { hasText: "Ada Lovelace" })).toContainText("In CRM");

  // ── the key's register counts what it sent; revoking it stops the site ───
  await tab(page, "Connect").click();
  const row = page.locator(".key-row", { hasText: "calimero.network contact page" });
  await expect(row).toContainText("1 response");
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("No form keys yet.")).toBeVisible({ timeout: 30_000 });
  await expect(
    submit({ name: ["Too late"], email: ["late@example.com"], message: ["hello"], topic: ["Cloud"] }),
  ).rejects.toThrow();
});
