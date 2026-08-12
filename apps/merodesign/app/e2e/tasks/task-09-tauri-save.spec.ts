import { test, expect } from "@playwright/test";
import { openBoard, installTauriStub, tauriCalls } from "../fixtures/board";
import { element } from "../fixtures/canvas";

/**
 * IMPORTANT.md item 9 — "Save as png or as svg or as project .merodesign does not
 * work in tauri".
 *
 * `showSaveFilePicker` does not exist in the Tauri webview and the `<a download>`
 * fallback is ignored there, so both branches dead-ended; `exportProject` did not
 * even use the shared helper. Everything now goes through `utils/saveFile`.
 *
 * This spec forces the Tauri bridge in both projects, because the whole point is
 * the desktop path.
 */
const ONE = [element({ id: "a", x: 100, y: 100, fill: "#FF00FF" })];

async function openWithBridge(page: import("@playwright/test").Page) {
  await installTauriStub(page);
  return openBoard(page, { elements: ONE, tauri: true });
}

test.describe("item 9: saving under Tauri", () => {
  test("Export PNG goes through the dialog then the fs plugin", async ({ page }) => {
    await openWithBridge(page);
    await page.locator('[data-testid="options-btn"]').click();
    await page.locator('[data-testid="export-png"]').click();
    await expect.poll(async () => (await tauriCalls(page)).map((c) => c.cmd), { timeout: 20000 })
      .toEqual(["plugin:dialog|save", "plugin:fs|write_file"]);
  });

  test("the bytes handed to write_file are a real PNG", async ({ page }) => {
    await openWithBridge(page);
    await page.locator('[data-testid="options-btn"]').click();
    await page.locator('[data-testid="export-png"]').click();
    await expect.poll(async () => (await tauriCalls(page)).length, { timeout: 20000 }).toBe(2);
    const write = (await tauriCalls(page))[1].args as { data: number[] };
    // PNG magic number
    expect(write.data.slice(0, 4)).toEqual([137, 80, 78, 71]);
  });

  test("no download anchor is created under Tauri", async ({ page }) => {
    await openWithBridge(page);
    await page.evaluate(() => {
      (window as unknown as { __ANCHORS__: number }).__ANCHORS__ = 0;
      const orig = document.createElement.bind(document);
      document.createElement = ((tag: string) => {
        if (tag === "a") (window as unknown as { __ANCHORS__: number }).__ANCHORS__++;
        return orig(tag);
      }) as typeof document.createElement;
    });
    await page.locator('[data-testid="options-btn"]').click();
    await page.locator('[data-testid="export-png"]').click();
    await expect.poll(async () => (await tauriCalls(page)).length, { timeout: 20000 }).toBe(2);
    expect(await page.evaluate(() => (window as unknown as { __ANCHORS__: number }).__ANCHORS__)).toBe(0);
  });

  test("Export SVG writes svg markup", async ({ page }) => {
    await openWithBridge(page);
    await page.locator('[data-testid="options-btn"]').click();
    await page.locator('[data-testid="export-svg"]').click();
    await expect.poll(async () => (await tauriCalls(page)).length, { timeout: 20000 }).toBe(2);
    const write = (await tauriCalls(page))[1].args as { data: number[]; path: string };
    const text = new TextDecoder().decode(new Uint8Array(write.data));
    expect(text).toContain("<svg");
  });

  test("Save (.merodesign) uses the same two invokes, not an anchor", async ({ page }) => {
    await openWithBridge(page);
    await page.locator('[data-testid="options-btn"]').click();
    await page.locator('[data-testid="save-project"]').click();
    await expect.poll(async () => (await tauriCalls(page)).map((c) => c.cmd), { timeout: 20000 })
      .toEqual(["plugin:dialog|save", "plugin:fs|write_file"]);
    const write = (await tauriCalls(page))[1].args as { data: number[] };
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(write.data)));
    expect(json.version).toBe(1);
  });
});
