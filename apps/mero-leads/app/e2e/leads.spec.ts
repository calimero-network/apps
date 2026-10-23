import { expect, test, type Page } from "@playwright/test";
import { RelayClient, createMemoryNonceSource } from "@calimero-network/mero-js";
import { btn, login, state, unique, waitForTeam } from "./helpers";

/**
 * The whole path a lead takes, against a real merod:
 *
 *   an admin issues a form key in the app
 *   → a "website" submits with ONLY that key, by delegated execution, the way
 *     calimero-network/landing's api/contact.ts does (here the node itself is
 *     the relay; in production it is a Calimero Cloud relay)
 *   → the lead lands in New, the team moves it and works it
 *   → revoking the key stops that website writing.
 *
 * One test on purpose: each step needs the state the last one left.
 */

/** The four values the app shows once, parsed out of its env block. */
async function issueKey(page: Page, label: string) {
  await page.getByRole("tab", { name: "Forms" }).click();
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
  ]);
  return vars;
}

/** What the website's backend does: sign a warrant for submit_lead and hand it to a relay. */
function websiteBackend(vars: Record<string, string>) {
  const relay = new RelayClient({
    relayUrl: state().nodeUrl,
    authorAccount: vars["CALIMERO_FORM_ACCOUNT"]!,
    authorProof: vars["CALIMERO_FORM_CREDENTIAL"]!,
    deviceSecret: vars["CALIMERO_FORM_DEVICE_SECRET"]!,
    nonces: createMemoryNonceSource(Date.now()),
  });
  return (lead: { name: string; email: string; company: string; message: string; source: string }) =>
    relay.execute<string>(vars["CALIMERO_CONTEXT_ID"]!, "submit_lead", lead);
}

test("a website lead arrives through a form key and the team works it", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await login(page);
  await waitForTeam(page);
  await expect(page.getByText("No leads yet")).toBeVisible();

  // ── issue a key ──────────────────────────────────────────────────────────
  const vars = await issueKey(page, "Contact page");
  expect(vars["CALIMERO_CONTEXT_ID"]).toBe(state().contextId);
  await btn(page, "Done").click();
  await expect(page.locator(".key-row", { hasText: "Contact page" })).toContainText("0 leads");

  // ── let this node be the relay, from the app ─────────────────────────────
  const relay = page.getByTestId("node-relay");
  await relay.getByRole("button", { name: "Let this node write for form keys" }).click();
  await expect(relay).toContainText("This node can write for form keys", { timeout: 30_000 });

  // ── the website submits with nothing but the key ─────────────────────────
  const submit = websiteBackend(vars);
  const name = unique("Ada");
  const sent = await submit({
    name,
    email: "ada@example.com",
    company: "Analytical Engines",
    message: "We'd like to run a sealed node.",
    source: "/contact/",
  });
  expect(sent.returns).toMatch(/^[0-9a-f]{32}$/);

  // ── it lands in New ──────────────────────────────────────────────────────
  await page.getByRole("tab", { name: "Leads" }).click();
  const newColumn = page.getByTestId("column-new");
  const card = newColumn.locator(".lead-card", { hasText: name });
  await expect(card).toBeVisible({ timeout: 30_000 });

  // ── drag it on ───────────────────────────────────────────────────────────
  await card.dragTo(page.getByTestId("column-contacted"));
  await expect(page.getByTestId("column-contacted").locator(".lead-card", { hasText: name })).toBeVisible();

  // ── work it in the panel ─────────────────────────────────────────────────
  await page.getByTestId("column-contacted").locator(".lead-card", { hasText: name }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("We'd like to run a sealed node.")).toBeVisible();
  await panel.getByRole("radio", { name: "Qualified" }).click();
  await expect(panel.getByRole("radio", { name: "Qualified" })).toHaveAttribute("aria-checked", "true");
  await panel.getByLabel("notes").fill("Call booked for Thursday");
  await panel.getByLabel("company").fill("Lovelace & Co");
  await btn(page, "Save changes").click();
  await expect(panel.getByText("Sent as: Analytical Engines")).toBeVisible();

  // ── it is the contract's state, not the page's ───────────────────────────
  await page.reload();
  await waitForTeam(page);
  const qualified = page.getByTestId("column-qualified").locator(".lead-card", { hasText: name });
  await expect(qualified).toContainText("Lovelace & Co", { timeout: 30_000 });
  await qualified.click();
  await expect(page.getByRole("dialog").getByLabel("notes")).toHaveValue("Call booked for Thursday");
  await page.getByRole("button", { name: "close" }).click();

  // ── the key's register counts what it sent ───────────────────────────────
  await page.getByRole("tab", { name: "Forms" }).click();
  const row = page.locator(".key-row", { hasText: "Contact page" });
  await expect(row).toContainText("1 lead");

  // ── revoking it stops that website ───────────────────────────────────────
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("No form keys yet.")).toBeVisible({ timeout: 30_000 });
  await expect(
    submit({ name: "Too late", email: "late@example.com", company: "", message: "hello", source: "" }),
  ).rejects.toThrow();
});
