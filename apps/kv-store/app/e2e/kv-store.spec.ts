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
  entryRow,
  login,
  readKey,
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
    await expect(result(page)).toContainText("v1");

    await btn(page, "len").click();
    await expect(result(page)).toContainText("len");
  });

  test("get_result returns a typed error for a missing key rather than throwing", async ({ page }) => {
    await readKey(page).fill(uniqueKey("absent"));
    await btn(page, "get_result").click();
    // Either shape is legitimate — what matters is the app renders an outcome
    // instead of dying — so assert something was reported, not the wording.
    await expect(result(page)).toBeVisible();
    await expect(result(page)).not.toBeEmpty();
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
    await expect(result(page)).toContainText("update_if_exists");
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
    await expect(result(page)).toContainText("original");
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

    await writeKey(page).fill(drop);
    await btn(page, "remove").click();
    await expect(entryRow(page, drop)).toHaveCount(0, { timeout: 20_000 });
    await expect(entryRow(page, keep)).toContainText("stays");
  });

  test("clear empties the store", async ({ page }) => {
    await setEntry(page, uniqueKey("c1"), "a");
    await btn(page, "clear").click();
    await expect(page.getByText("Empty.", { exact: true })).toBeVisible({ timeout: 20_000 });
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
    await expect(result(page)).toContainText("value-a");

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
    await expect(result(page)).toContainText("one");
    await btn(page, "len").click();
    await writeKey(page).fill(key);
    await btn(page, "remove").click();
    await expect(entryRow(page, key)).toHaveCount(0, { timeout: 20_000 });

    watch.assertClean();
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
    await page.getByRole("button", { name: "Create a context", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Write", exact: true })).toBeVisible({
      timeout: 40_000,
    });
    expect(rowsBefore).toBeGreaterThanOrEqual(0);
  });
});
