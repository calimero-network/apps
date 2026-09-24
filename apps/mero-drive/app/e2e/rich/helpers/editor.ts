// Drives the editor the way a person does, with real key events, and finds
// everything through the fixed data-testid contract.

import { expect, type Page } from '@playwright/test';

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Puts the caret `offset` characters into a block, counting from its start. */
export async function caretTo(page: Page, blockIndex: number, offset: number): Promise<void> {
  // The block's own text, never its wrapper: BlockNote reads a click below a
  // block's text as "add a block here" and moves the caret into the new one.
  const text = page.getByTestId('doc-editor').locator('.bn-inline-content').nth(blockIndex);
  await text.click();
  await page.keyboard.press('Home');
  for (let step = 0; step < offset; step++) await page.keyboard.press('ArrowRight');
}

export async function applyBold(page: Page): Promise<void> {
  await page.keyboard.press(`${MOD}+b`);
}

export async function applyItalic(page: Page): Promise<void> {
  await page.keyboard.press(`${MOD}+i`);
}

export async function applyLink(page: Page, url: string): Promise<void> {
  await page.keyboard.press(`${MOD}+k`);
  const input = page.locator('input:focus');
  await input.fill(url);
  await input.press('Enter');
}

// ─── title ──────────────────────────────────────────────────────────

export function titleInput(page: Page) {
  return page.getByTestId('doc-title-input');
}

// ─── history ────────────────────────────────────────────────────────

export async function undo(page: Page): Promise<void> {
  await page.getByTestId('doc-undo').click();
}

export async function redo(page: Page): Promise<void> {
  await page.getByTestId('doc-redo').click();
}

/** Selects `text` inside a block through the browser selection, then waits
 *  until the editor holds exactly it: fast Shift+Arrow presses get dropped. */
export async function selectText(page: Page, blockIndex: number, text: string): Promise<void> {
  await caretTo(page, blockIndex, 0);
  await page.evaluate(
    ({ index, needle }) => {
      const root = document.querySelectorAll('[data-testid="doc-editor"] .bn-inline-content')[index];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = (node.textContent ?? '').indexOf(needle);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      throw new Error(`"${needle}" is not in block ${index}`);
    },
    { index: blockIndex, needle: text },
  );
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text);
}

/** The text of the block the caret sits in, as the browser reports it. */
export function caretBlockText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const node = window.getSelection()?.anchorNode ?? null;
    const element = node instanceof Element ? node : (node?.parentElement ?? null);
    return element?.closest('[data-content-type]')?.textContent ?? null;
  });
}
