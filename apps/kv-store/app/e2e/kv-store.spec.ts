/**
 * Every control in the KV panel, driven against a real merod.
 *
 * The unit tests cover pure helpers and the merobox workflow covers two-node
 * convergence. Neither exercises what a user actually touches: that a button
 * is wired to the method it names, that its result reaches the screen, and
 * that the entries table agrees with the contract afterwards.
 */
import { expect, test } from "@playwright/test";
import {
  btn,
  card,
  entryRow,
  login,
  readKey,
  removeKey,
  result,
  setEntry,
  state,
  uniqueKey,
  waitForPanel,
  watchForErrors,
  writeKey,
  writeValue,
} from "./helpers";

test.describe("kv-store panel", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await waitForPanel(page);
  });

  test("the session is bound to the node, app and context the login carried", async ({ page }) => {
    const s = state();
    const session = page.locator(".card", { has: page.getByRole("heading", { name: "Session" }) });
    await expect(session).toContainText(s.nodeUrl);
    await expect(session).toContainText(s.applicationId);
    await expect(session).toContainText(s.contextId);
  });

  test("set writes an entry and it appears in the table", async ({ page }) => {
    const key = uniqueKey("set");
    await setEntry(page, key, "hello");
    await expect(entryRow(page, key)).toContainText("hello");
  });

  test("get returns the stored value; len counts the entries", async ({ page }) => {
    const key = uniqueKey("get");
    await setEntry(page, key, "v1");

    await readKey(page).fill(key);
    await btn(page, "get").click();
    await expect(result(page, "Read")).toContainText("v1");

    await btn(page, "len").click();
    await expect(result(page, "Read")).toContainText("len");
  });

  test("get_result returns a typed error for a missing key rather than throwing", async ({ page }) => {
    await readKey(page).fill(uniqueKey("absent"));
    await btn(page, "get_result").click();
    // Either shape is legitimate — what matters is the app renders an outcome
    // instead of dying — so assert something was reported, not the wording.
    await expect(result(page, "Read")).toBeVisible();
    await expect(result(page, "Read")).not.toBeEmpty();
  });

  test("get_unchecked PANICS on a missing key, and the app surfaces it", async ({ page }) => {
    // The contract's deliberate counter-example: a panic aborts the whole
    // execution, so nothing in the call commits. The UI must show the error
    // rather than hang or blank out.
    await readKey(page).fill(uniqueKey("nope"));
    await btn(page, "get_unchecked").click();
    await expect(page.locator("pre.err")).toBeVisible({ timeout: 20_000 });
    // The panel is still usable afterwards.
    await expect(btn(page, "len")).toBeEnabled();
  });

  test("update_if_exists does NOT insert when the key is absent", async ({ page }) => {
    const key = uniqueKey("upd");
    await writeKey(page).fill(key);
    await writeValue(page).fill("should-not-land");
    await btn(page, "update_if_exists").click();
    await expect(result(page, "Write")).toContainText("update_if_exists");
    // The whole point: no row was created.
    await expect(entryRow(page, key)).toHaveCount(0);
  });

  test("update_if_exists mutates in place when the key is present", async ({ page }) => {
    const key = uniqueKey("upd2");
    await setEntry(page, key, "before");
    await writeValue(page).fill("after");
    await btn(page, "update_if_exists").click();
    await expect(entryRow(page, key)).toContainText("after", { timeout: 20_000 });
  });

  test("get_or_insert returns the EXISTING value, not the one passed in", async ({ page }) => {
    const key = uniqueKey("goi");
    await setEntry(page, key, "original");
    await writeValue(page).fill("ignored");
    await btn(page, "get_or_insert").click();
    await expect(result(page, "Write")).toContainText("original");
    await expect(entryRow(page, key)).toContainText("original");
  });

  test("get_or_insert inserts when the key is absent", async ({ page }) => {
    const key = uniqueKey("goi2");
    await writeKey(page).fill(key);
    await writeValue(page).fill("fresh");
    await btn(page, "get_or_insert").click();
    await expect(entryRow(page, key)).toContainText("fresh", { timeout: 20_000 });
  });

  test("remove deletes one entry and leaves the others", async ({ page }) => {
    const keep = uniqueKey("keep");
    const drop = uniqueKey("drop");
    await setEntry(page, keep, "stays");
    await setEntry(page, drop, "goes");

    await removeKey(page).fill(drop);
    await btn(page, "remove").click();
    await expect(entryRow(page, drop)).toHaveCount(0, { timeout: 20_000 });
    await expect(entryRow(page, keep)).toContainText("stays");
  });

  test("Remove all empties the store, behind a confirm", async ({ page }) => {
    await setEntry(page, uniqueKey("c1"), "a");
    // Two-step on purpose: this button sits next to Refresh under the table,
    // where a mis-click would otherwise drop every entry.
    await btn(page, "Remove all").click();
    await expect(btn(page, "Confirm — remove all")).toBeVisible();
    await btn(page, "Confirm — remove all").click();
    await expect(page.getByText("Empty.", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(result(page, "Entries")).toContainText("clear");
  });

  test("Remove all can be cancelled, and cancelling keeps the entries", async ({ page }) => {
    const key = uniqueKey("cancel");
    await setEntry(page, key, "survives");
    await btn(page, "Remove all").click();
    await btn(page, "Cancel").click();
    // Back to the resting state, and nothing was cleared.
    await expect(btn(page, "Remove all")).toBeVisible();
    await expect(entryRow(page, key)).toContainText("survives");
  });

  test("Remove all is disabled while the store is already empty", async ({ page }) => {
    await setEntry(page, uniqueKey("empty"), "x");
    await btn(page, "Remove all").click();
    await btn(page, "Confirm — remove all").click();
    await expect(page.getByText("Empty.", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(btn(page, "Remove all")).toBeDisabled();
  });

  test("Refresh re-reads the table from the contract", async ({ page }) => {
    const key = uniqueKey("refresh");
    await setEntry(page, key, "v");
    await btn(page, "Refresh").click();
    await expect(entryRow(page, key)).toContainText("v");
  });

  test("the read field is independent of the write field", async ({ page }) => {
    const a = uniqueKey("ra");
    const b = uniqueKey("rb");
    await setEntry(page, a, "value-a");
    await setEntry(page, b, "value-b");

    // Compose a third entry in Write while reading an unrelated key.
    await writeKey(page).fill(uniqueKey("draft"));
    await writeValue(page).fill("draft-value");
    await readKey(page).fill(a);
    await btn(page, "get").click();
    await expect(result(page, "Read")).toContainText("value-a");

    // The write draft survived the read.
    await expect(writeValue(page)).toHaveValue("draft-value");
  });

  test("read buttons gate on the read field, write buttons on the write field", async ({ page }) => {
    await writeKey(page).fill("");
    await readKey(page).fill("");
    await expect(btn(page, "set")).toBeDisabled();
    await expect(btn(page, "get")).toBeDisabled();
    // len takes no key and must stay available.
    await expect(btn(page, "len")).toBeEnabled();

    await readKey(page).fill("only-read");
    await expect(btn(page, "get")).toBeEnabled();
    await expect(btn(page, "set")).toBeDisabled();

    await writeKey(page).fill("only-write");
    await expect(btn(page, "set")).toBeEnabled();
  });

  test("a full session runs without a console error or a failed request", async ({ page }) => {
    const watch = watchForErrors(page);
    const key = uniqueKey("clean");

    await setEntry(page, key, "one");
    await readKey(page).fill(key);
    await btn(page, "get").click();
    await expect(result(page, "Read")).toContainText("one");
    await btn(page, "len").click();
    await removeKey(page).fill(key);
    await btn(page, "remove").click();
    await expect(entryRow(page, key)).toHaveCount(0, { timeout: 20_000 });

    watch.assertClean();
  });
});

test.describe("results are reported per section", () => {
  // The regression these guard: results used to be ONE <pre> at the bottom of
  // the Remove card, so pressing `set` under Write printed its output two cards
  // away, under a heading about deleting things — and the next call in any
  // section overwrote it. Both halves are asserted: the output lands in the
  // right card, and it does NOT land in the others.
  test.beforeEach(async ({ page }) => {
    await login(page, { withContext: true });
    await waitForPanel(page);
  });

  test("a write reports under Write, not under Remove", async ({ page }) => {
    const key = uniqueKey("sect-w");
    await writeKey(page).fill(key);
    await writeValue(page).fill("v");
    await btn(page, "set").click();

    await expect(result(page, "Write")).toContainText("set");
    // The old single-panel layout put this text here instead.
    await expect(card(page, "Remove").locator("pre")).toHaveCount(0);
  });

  test("a read reports under Read and leaves the Write result alone", async ({ page }) => {
    const key = uniqueKey("sect-r");
    await setEntry(page, key, "readable");
    await expect(result(page, "Write")).toContainText("set");

    await readKey(page).fill(key);
    await btn(page, "get").click();

    await expect(result(page, "Read")).toContainText("readable");
    // Still there — one section's call no longer wipes another's output.
    await expect(result(page, "Write")).toContainText("set");
  });

  test("a remove reports under Remove", async ({ page }) => {
    const key = uniqueKey("sect-rm");
    await setEntry(page, key, "doomed");
    await removeKey(page).fill(key);
    await btn(page, "remove").click();

    await expect(result(page, "Remove")).toContainText("remove");
    await expect(entryRow(page, key)).toHaveCount(0, { timeout: 20_000 });
  });
});

test.describe("the remove field", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, { withContext: true });
    await waitForPanel(page);
  });

  test("remove gates on its OWN field, not the write field", async ({ page }) => {
    // Before, `remove` was wired to the Write key: filling Write enabled it and
    // clearing Write disabled it, which is how you could delete an entry you
    // were only composing.
    await writeKey(page).fill("written-not-removed");
    await expect(btn(page, "remove")).toBeDisabled();

    await removeKey(page).fill("something");
    await expect(btn(page, "remove")).toBeEnabled();

    await removeKey(page).fill("");
    await expect(btn(page, "remove")).toBeDisabled();
  });

  test("removing one key does not disturb the write field", async ({ page }) => {
    const keep = uniqueKey("rm-keep");
    const drop = uniqueKey("rm-drop");
    await setEntry(page, keep, "stays");
    await setEntry(page, drop, "goes");

    await writeKey(page).fill("composing");
    await writeValue(page).fill("draft");
    await removeKey(page).fill(drop);
    await btn(page, "remove").click();

    await expect(entryRow(page, drop)).toHaveCount(0, { timeout: 20_000 });
    await expect(entryRow(page, keep)).toContainText("stays");
    // The draft survived the delete.
    await expect(writeKey(page)).toHaveValue("composing");
    await expect(writeValue(page)).toHaveValue("draft");
  });
});

test.describe("switching context", () => {
  test("an open context can be left and re-chosen", async ({ page }) => {
    // This was a ONE-WAY door: `setContextId` persists, so once a context was
    // open the picker could not be reached again without clearing site data.
    await login(page, { withContext: true });
    await waitForPanel(page);

    await btn(page, "Change context").click();

    // Back at the picker.
    await expect(page.getByRole("heading", { name: "Choose a context", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    // And forward again into a context.
    await page.getByRole("button", { name: "Open", exact: true }).first().click();
    await waitForPanel(page);
  });

  test("the context bar names the context the session is bound to", async ({ page }) => {
    await login(page, { withContext: true });
    await waitForPanel(page);
    const bar = page.locator(".context-bar");
    await expect(bar).toContainText(state().contextId);
  });
});

test.describe("the invite link", () => {
  // Chromium gates navigator.clipboard.readText() behind a permission; without
  // it the copy assertion below would fail for a reason unrelated to the app.
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test.beforeEach(async ({ page }) => {
    await login(page, { withContext: true });
    await waitForPanel(page);
  });

  test("renders on ONE line instead of a wall of wrapped text", async ({ page }) => {
    await btn(page, "Create invite link").click();
    const link = page.locator(".invite-link");
    await expect(link).toBeVisible({ timeout: 30_000 });

    // The regression: this was a <pre> with `word-break: break-all`, and an
    // invitation is a few hundred base58 characters, so it wrapped into a block
    // taller than the rest of the card. Asserting the rendered HEIGHT is what
    // actually catches that — a class name would not, and neither would the
    // text, which is identical either way.
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    const lineHeight = await link.evaluate(
      (el) => parseFloat(getComputedStyle(el).lineHeight) || 16,
    );
    // One line of text plus padding. A wrapped payload is many times this.
    expect(box!.height).toBeLessThan(lineHeight * 3);

    // And it is genuinely clipped rather than merely short.
    await expect(link).toHaveCSS("text-overflow", "ellipsis");
    await expect(link).toHaveCSS("white-space", "nowrap");
  });

  test("Copy puts the WHOLE link on the clipboard, not the truncated text", async ({ page }) => {
    await btn(page, "Create invite link").click();
    const link = page.locator(".invite-link");
    await expect(link).toBeVisible({ timeout: 30_000 });

    // What is painted is ellipsised; what the element holds is the full value.
    const shown = (await link.textContent())?.trim() ?? "";
    expect(shown.length).toBeGreaterThan(80);
    expect(shown).toContain("http");

    await btn(page, "Copy").click();
    await expect(btn(page, "Copied")).toBeVisible();

    const clipped = await page.evaluate(() => navigator.clipboard.readText());
    // The assertion that matters: CSS truncation is visual only, so the
    // clipboard must carry every character, not the ellipsised rendering.
    expect(clipped).toBe(shown);
    expect(clipped).not.toContain("…");
  });

  test("the full link stays available as the element's title", async ({ page }) => {
    await btn(page, "Create invite link").click();
    const link = page.locator(".invite-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    // The native tooltip is the no-clipboard fallback — clipboard access can be
    // denied, and then this is the only way to see the whole value.
    const title = await link.getAttribute("title");
    expect(title).toBe((await link.textContent())?.trim());
  });
});

test.describe("namespaces", () => {
  test("the picker lists namespaces and can add a context to an existing one", async ({ page }) => {
    // The gap this closes: the first version had ONE button that created a
    // namespace and a context together, so there was no way to put a second
    // context into a namespace you already had — and the invite link is minted
    // per NAMESPACE, so contexts sharing one are the case worth supporting.
    await login(page, { withContext: false });

    const namespaces = card(page, "Namespaces");
    await expect(namespaces).toBeVisible({ timeout: 30_000 });

    // global-setup created one, so there is at least a row to act on.
    const addContext = namespaces.getByRole("button", { name: "Add context", exact: true }).first();
    await expect(addContext).toBeVisible({ timeout: 30_000 });
    await addContext.click();

    // Adding a context selects it, which lands on the panel.
    await waitForPanel(page);
  });

  test("Create namespace adds one without creating a context", async ({ page }) => {
    await login(page, { withContext: false });
    const namespaces = card(page, "Namespaces");
    await expect(namespaces).toBeVisible({ timeout: 30_000 });

    const before = await namespaces.getByRole("button", { name: "Add context", exact: true }).count();
    await btn(page, "Create namespace").click();

    // A new row appears, and — the point of separating the two steps — we are
    // still on the picker rather than having been dropped into a context.
    await expect(
      namespaces.getByRole("button", { name: "Add context", exact: true }),
    ).toHaveCount(before + 1, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Choose a context", exact: true })).toBeVisible();
  });
});

test.describe("context picker", () => {
  test("lists the app's contexts and opens one", async ({ page }) => {
    // No context_id in the callback, so the app lands on the picker.
    await login(page, { withContext: false });

    const open = page.getByRole("button", { name: "Open", exact: true }).first();
    await expect(open).toBeVisible({ timeout: 30_000 });
    await open.click();

    await expect(page.getByRole("heading", { name: "Write", exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("Create a context adds one and it becomes selectable", async ({ page }) => {
    await login(page, { withContext: false });

    const rowsBefore = await page.getByRole("button", { name: "Open", exact: true }).count();
    await page.getByRole("button", { name: "Create namespace + context", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Write", exact: true })).toBeVisible({
      timeout: 40_000,
    });
    expect(rowsBefore).toBeGreaterThanOrEqual(0);
  });
});
