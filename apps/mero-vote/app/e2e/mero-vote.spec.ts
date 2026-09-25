/**
 * A whole poll through the UI, against a real merod: key ceremony, encrypted
 * ballot, close, threshold decryption, audit on the node, independent re-audit
 * in the browser, public anchor.
 *
 * One account plays every role (creator, sole trustee, voter), which is the one
 * configuration a single node can host. What it proves is the part no other
 * tier does: that the TypeScript prover and the WASM verifier agree on a real
 * node, over the real JSON-RPC wire — a ballot the browser builds is accepted,
 * counted and decrypted by the contract, and the browser's own verifier
 * reproduces the node's tally digest.
 */
import { expect, test, type Request } from "@playwright/test";
import { btn, card, login, uniqueTitle, waitForPanel, watchForErrors } from "./helpers";

const TIMEOUT = 30_000;

function rpcCall(req: Request): { method?: string; args?: Record<string, unknown> } {
  try {
    const body = JSON.parse(req.postData() ?? "{}");
    const p = body.params ?? {};
    return { method: p.method, args: p.argsJson ?? p.args_json ?? p.args };
  } catch {
    return {};
  }
}

test.describe("mero-vote", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await waitForPanel(page);
  });

  test("a poll runs end to end and the browser reproduces the node's tally", async ({ page }) => {
    test.setTimeout(180_000);
    const watch = watchForErrors(page);

    const ballots: Record<string, unknown>[] = [];
    page.on("request", (req) => {
      const c = rpcCall(req);
      if (c.method === "cast_ballot" && c.args) ballots.push(c.args);
    });

    // Join the roster.
    await page.getByLabel("Your name").fill("Ada");
    await btn(page, "Join roster").click();
    await expect(card(page, "You")).toContainText("Ada", { timeout: TIMEOUT });

    // Create a single-choice poll with yourself as the only trustee.
    const title = uniqueTitle("Offsite");
    await btn(page, "New poll").click();
    await page.getByPlaceholder("Where do we hold the offsite?").fill(title);
    await page.getByRole("textbox", { name: "Option 1", exact: true }).fill("Lisbon");
    await page.getByRole("textbox", { name: "Option 2", exact: true }).fill("Split");
    await btn(page, "Add option").click();
    await page.getByRole("textbox", { name: "Option 3", exact: true }).fill("Tallinn");
    await btn(page, "Create poll").click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: TIMEOUT });

    // Key ceremony.
    await btn(page, "Generate & publish my key share").click();
    await expect(page.getByText("Key share published.")).toBeVisible({ timeout: TIMEOUT });
    await expect(btn(page, "Download key backup")).toBeVisible();
    await btn(page, "Open voting").click();
    await expect(page.getByText("Voting is open.")).toBeVisible({ timeout: TIMEOUT });

    // Vote.
    await page.getByRole("radio", { name: "Split" }).check();
    await btn(page, "Encrypt & cast ballot").click();
    await expect(page.getByText("Ballot cast.")).toBeVisible({ timeout: TIMEOUT });
    await expect(page.getByText(/Your receipt/)).toBeVisible();

    // What went over the wire: ciphertexts and proofs, nothing else.
    expect(ballots).toHaveLength(1);
    const sent = ballots[0]! as { poll_id: string; ballot: { choices: { a: string; b: string; proof: unknown[] }[]; sum_proof: unknown[] } };
    expect(Object.keys(sent).sort()).toEqual(["ballot", "poll_id"]);
    expect(sent.ballot.choices).toHaveLength(3);
    for (const ch of sent.ballot.choices) {
      expect(ch.a).toMatch(/^[0-9a-f]{64}$/);
      expect(ch.b).toMatch(/^[0-9a-f]{64}$/);
      expect(ch.proof).toHaveLength(2);
    }
    expect(JSON.stringify(sent)).not.toContain("Split");

    // Close and decrypt.
    await btn(page, "Close poll").click();
    await expect(page.getByText("Poll closed.")).toBeVisible({ timeout: TIMEOUT });
    await expect(page.getByText(/is in the counted set/)).toBeVisible();
    await btn(page, "Publish my decryption share").click();
    await expect(page.getByText("Decryption share published.")).toBeVisible({ timeout: TIMEOUT });

    const result = card(page, "Result");
    await expect(result.locator(".bar-row", { hasText: "Split" }).locator(".bar-count")).toHaveText("1", { timeout: TIMEOUT });
    await expect(result.locator(".bar-row", { hasText: "Lisbon" }).locator(".bar-count")).toHaveText("0");
    await expect(result.locator(".bar-row", { hasText: "Tallinn" }).locator(".bar-count")).toHaveText("0");

    // The node's audit, then the browser's own.
    const audit = card(page, "Audit");
    await expect(audit.locator(".checks li.bad")).toHaveCount(0);
    await expect(audit.locator(".digest")).toHaveText(/^[0-9a-f]{64}$/);
    await btn(page, "Re-verify in this browser").click();
    await expect(page.getByText("✓ This browser independently reproduced the node's result.")).toBeVisible({ timeout: 60_000 });

    // Anchor the digest.
    await page.getByPlaceholder(/network/).fill("git");
    await page.getByPlaceholder(/reference/).fill("refs/tags/offsite-vote");
    await btn(page, "Record anchor").click();
    await expect(card(page, "Public anchor")).toContainText("refs/tags/offsite-vote", { timeout: TIMEOUT });
    await expect(audit.locator(".checks li", { hasText: "anchor" })).toHaveClass(/ok/);

    watch.assertClean();
  });

  test("a poll is listed and reopens from the list", async ({ page }) => {
    const title = uniqueTitle("Listed");
    await btn(page, "New poll").click();
    await page.getByPlaceholder("Where do we hold the offsite?").fill(title);
    await page.getByRole("textbox", { name: "Option 1", exact: true }).fill("Yes");
    await page.getByRole("textbox", { name: "Option 2", exact: true }).fill("No");
    await btn(page, "Create poll").click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: TIMEOUT });
    await btn(page, "← All polls").click();
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("Key ceremony").first()).toBeVisible();
  });
});
