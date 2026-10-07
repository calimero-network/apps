import { test, expect, type Page } from "@playwright/test";
import { openBoard, installTauriStub, tauriCalls } from "../fixtures/board";
import { element } from "../fixtures/canvas";
import { downloads, recordDownloads } from "../fixtures/downloads";

/**
 * IMPORTANT.md item 9 — "Save as png or as svg or as project .mero-design does not
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
    expect(file.download).toBe("mero-design-export.png");
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
    expect(file.download).toBe("mero-design-export.svg");
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

  test("an export says it went to the Downloads folder", async ({ page }) => {
    // The desktop webview writes into ~/Downloads with no prompt and no download
    // bar — without saying so, an export that worked looked like it did nothing.
    await openWithBridge(page);
    await exportVia(page, "export-png");
    await expect(page.getByTestId("toast").filter({ hasText: "saved to your Downloads folder" })).toBeVisible();
    await exportVia(page, "save-project");
    await expect(page.getByTestId("toast").filter({ hasText: /Project saved to your Downloads folder as “.*\.merodesign”/ })).toBeVisible();
  });
});

test.describe("Open (.merodesign) under Tauri", () => {
  test("works although the webview's window.confirm always answers false", async ({ page }) => {
    // wry implements no JavaScript confirm panel: `window.confirm` returns false
    // without showing anything, so a confirm-gated import was cancelled before
    // the user ever saw the question. Model that, and require the import anyway.
    await page.addInitScript(() => { window.confirm = () => false; });
    await installTauriStub(page);
    const board = await openBoard(page, { elements: ONE, tauri: true, role: "admin" });

    const snapshot = {
      version: 1,
      exportedAt: Date.now(),
      boardName: "",
      boardDescription: "",
      elements: [element({ id: "from-file", x: 300, y: 200, fill: "#00AA00" })],
      comments: [],
    };
    await page.getByTestId("import-file-input").setInputFiles({
      name: "board.merodesign",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(JSON.stringify(snapshot)),
    });

    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await page.getByTestId("confirm-ok").click();
    await expect(page.getByTestId("confirm-dialog")).toBeHidden();
    await expect(page.getByTestId("toast").filter({ hasText: "Project opened" })).toBeVisible({ timeout: 15000 });
    await expect.poll(() => board.elementsNow().map((el) => el.id)).toEqual(["from-file"]);
  });

  test("Cancel leaves the board alone, and a bad file says so", async ({ page }) => {
    await installTauriStub(page);
    const board = await openBoard(page, { elements: ONE, tauri: true, role: "admin" });
    await page.getByTestId("import-file-input").setInputFiles({
      name: "board.merodesign",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(JSON.stringify({ version: 1, exportedAt: 0, boardName: "", boardDescription: "", elements: [], comments: [] })),
    });
    await page.getByTestId("confirm-cancel").click();
    await expect(page.getByTestId("confirm-dialog")).toBeHidden();
    expect(board.elementsNow().map((el) => el.id)).toEqual(["a"]);

    await page.getByTestId("import-file-input").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
    await expect(page.getByTestId("toast").filter({ hasText: "not a Mero Design project file" })).toBeVisible();
  });
});
