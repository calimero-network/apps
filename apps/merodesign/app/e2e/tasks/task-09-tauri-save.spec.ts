import { test, expect, type Page } from "@playwright/test";
import { openBoard, installTauriStub, tauriCalls } from "../fixtures/board";
import { element } from "../fixtures/canvas";
import { downloads, recordDownloads } from "../fixtures/downloads";

/**
 * IMPORTANT.md item 9 — "Save as png or as svg or as project .merodesign does not
 * work in tauri".
 *
 * The first fix routed the desktop through `plugin:dialog|save` +
 * `plugin:fs|write_file`, and this spec proved it by asserting exactly those two
 * invokes against a bridge stub that answers everything. In the real desktop
 * shell neither call exists: `tauri-plugin-fs` is not a dependency of tauri-app,
 * and `dialog:allow-save` is granted only to its `main` window, not to the
 * `app-*` windows apps run in. Both rejected, silently.
 *
 * mero-pixart downloads fine in that same shell with a plain `<a download>` on a
 * `data:` URL, so that is what this now does — and what this spec pins. A stub
 * that answers every invoke can no longer make a broken export look tested.
 */
const ONE = [element({ id: "a", x: 100, y: 100, fill: "#FF00FF" })];

async function openWithBridge(page: Page) {
  await recordDownloads(page);
  await installTauriStub(page);
  return openBoard(page, { elements: ONE, tauri: true });
}

async function exportVia(page: Page, testId: string) {
  await page.locator('[data-testid="options-btn"]').click();
  await page.locator(`[data-testid="${testId}"]`).click();
}

test.describe("item 9: saving under Tauri", () => {
  test("Export PNG downloads a data: URL", async ({ page }) => {
    await openWithBridge(page);
    await exportVia(page, "export-png");
    await expect.poll(async () => (await downloads(page)).length, { timeout: 20000 }).toBe(1);
    const [file] = await downloads(page);
    expect(file.download).toBe("merodesign-export.png");
    expect(file.href.startsWith("data:image/png;base64,")).toBe(true);
  });

  test("the downloaded bytes are a real PNG", async ({ page }) => {
    await openWithBridge(page);
    await exportVia(page, "export-png");
    await expect.poll(async () => (await downloads(page)).length, { timeout: 20000 }).toBe(1);
    const [file] = await downloads(page);
    const magic = await page.evaluate((href) => {
      const binary = atob(href.split(",")[1]);
      return [0, 1, 2, 3].map((i) => binary.charCodeAt(i));
    }, file.href);
    expect(magic).toEqual([137, 80, 78, 71]);
  });

  test("no Tauri plugin command is invoked — the shell has none of them", async ({ page }) => {
    await openWithBridge(page);
    await exportVia(page, "export-png");
    await expect.poll(async () => (await downloads(page)).length, { timeout: 20000 }).toBe(1);
    const cmds = (await tauriCalls(page)).map((c) => c.cmd);
    expect(cmds.filter((c) => c.startsWith("plugin:dialog") || c.startsWith("plugin:fs"))).toEqual([]);
  });

  test("Export SVG downloads svg markup", async ({ page }) => {
    await openWithBridge(page);
    await exportVia(page, "export-svg");
    await expect.poll(async () => (await downloads(page)).length, { timeout: 20000 }).toBe(1);
    const [file] = await downloads(page);
    expect(file.download).toBe("merodesign-export.svg");
    const text = await page.evaluate((href) => decodeURIComponent(escape(atob(href.split(",")[1]))), file.href);
    expect(text).toContain("<svg");
  });

  test("Save (.merodesign) downloads the project snapshot", async ({ page }) => {
    await openWithBridge(page);
    await exportVia(page, "save-project");
    await expect.poll(async () => (await downloads(page)).length, { timeout: 20000 }).toBe(1);
    const [file] = await downloads(page);
    expect(file.download.endsWith(".merodesign")).toBe(true);
    const json = await page.evaluate((href) => JSON.parse(atob(href.split(",")[1])), file.href);
    expect(json.version).toBe(1);
    expect(json.elements).toHaveLength(1);
  });

  test("a browser session downloads a blob, never the Tauri data: URL", async ({ page }) => {
    // `showSaveFilePicker` is removed by `recordDownloads`: headless Chromium
    // opens a dialog that never resolves, and this is the branch every browser
    // without the File System Access API takes anyway.
    await recordDownloads(page);
    await openBoard(page, { elements: ONE, tauri: false });
    await exportVia(page, "export-png");
    await expect.poll(async () => (await downloads(page)).length, { timeout: 20000 }).toBe(1);
    const [file] = await downloads(page);
    expect(file.href.startsWith("blob:")).toBe(true);
  });
});
