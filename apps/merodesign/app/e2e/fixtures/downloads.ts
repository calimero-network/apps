import type { Page } from "@playwright/test";

/**
 * Captures the file a save produces, without letting the browser act on it.
 *
 * Two things make exports awkward to test for real:
 *  - headless Chromium's `showSaveFilePicker` opens a dialog that never
 *    resolves, so any spec that reaches it hangs rather than failing. Specs opt
 *    out with `disablePicker`, which is also the branch the Tauri webview and
 *    every non-Chromium browser take.
 *  - clicking a real download anchor navigates the page away in some cases.
 *
 * So the anchor's click is intercepted and recorded instead.
 */
export interface CapturedDownload {
  href: string;
  download: string;
}

export async function recordDownloads(
  page: Page,
  { disablePicker = true }: { disablePicker?: boolean } = {},
): Promise<void> {
  await page.addInitScript((noPicker: boolean) => {
    const clicks: CapturedDownload[] = [];
    (window as unknown as Record<string, unknown>).__DOWNLOADS__ = clicks;
    if (noPicker) delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    const realClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function patched(this: HTMLElement) {
      if (this instanceof HTMLAnchorElement && this.hasAttribute("download")) {
        clicks.push({ href: this.getAttribute("href") ?? "", download: this.download });
        return;
      }
      return realClick.call(this);
    };
  }, disablePicker);
}

export function downloads(page: Page): Promise<CapturedDownload[]> {
  return page.evaluate(() => (window as unknown as { __DOWNLOADS__: CapturedDownload[] }).__DOWNLOADS__);
}

/** The text behind a captured `data:`/`blob:`-free download href. */
export async function downloadText(page: Page, href: string): Promise<string> {
  return page.evaluate(async (url: string) => {
    const res = await fetch(url);
    return res.text();
  }, href);
}
