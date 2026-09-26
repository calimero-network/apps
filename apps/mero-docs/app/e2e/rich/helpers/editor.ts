// Drives the editor the way a person does, with real key events, and finds
// everything through the fixed data-testid contract.

import { expect, type Locator, type Page } from '@playwright/test';

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Where the caret sits inside the text of block `blockIndex`, or -1 elsewhere. */
function offsetIn(page: Page, blockIndex: number): Promise<number> {
  return page.evaluate((index) => {
    const text = document.querySelectorAll('[data-testid="doc-editor"] .bn-inline-content')[index];
    const selection = window.getSelection();
    if (!text || !selection || selection.rangeCount === 0) return -1;
    const range = selection.getRangeAt(0);
    if (!text.contains(range.startContainer)) return -1;
    const measured = document.createRange();
    measured.selectNodeContents(text);
    measured.setEnd(range.startContainer, range.startOffset);
    return measured.toString().length;
  }, blockIndex);
}

/** Puts the caret `offset` characters into a block, counting from its start. */
export async function caretTo(page: Page, blockIndex: number, offset: number): Promise<void> {
  const text = page.getByTestId('doc-editor').locator('.bn-inline-content').nth(blockIndex);
  // A peer's edit landing mid-move can shift the layout or the text under the
  // caret, so confirm it sits exactly where asked and place it again if not.
  await expect(async () => {
    await text.click();
    await collapseToEdge(text, 'start');
    for (let step = 0; step < offset; step++) await page.keyboard.press('ArrowRight');
    expect(await offsetIn(page, blockIndex), `caret at ${blockIndex}:${offset}`).toBe(offset);
  }).toPass({ timeout: 20_000 });
}

/** Collapses the selection to one edge of a block's text and returns its length.
 *  Not Home or End: on Linux they stop at the visual line, so a wrapped block misses. */
function collapseToEdge(text: Locator, edge: 'start' | 'end'): Promise<number> {
  return text.evaluate((node, toStart) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(toStart);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return (node.textContent ?? '').length;
  }, edge === 'start');
}

/** Puts the caret at the end of a block's text. */
export async function caretToEnd(page: Page, blockIndex: number): Promise<void> {
  const text = page.getByTestId('doc-editor').locator('.bn-inline-content').nth(blockIndex);
  await expect(async () => {
    await text.click();
    const length = await collapseToEdge(text, 'end');
    expect(await offsetIn(page, blockIndex), `caret at the end of block ${blockIndex}`).toBe(length);
  }).toPass({ timeout: 20_000 });
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

/** Selects `text` inside a block with Shift+Arrow, as a person does, and
 *  confirms the editor holds exactly that selection before returning. */
export async function selectText(page: Page, blockIndex: number, text: string): Promise<void> {
  await expect(async () => {
    const start = await page
      .getByTestId('doc-editor')
      .locator('.bn-inline-content')
      .nth(blockIndex)
      .evaluate((node, needle) => (node.textContent ?? '').indexOf(needle), text);
    expect(start, `"${text}" in block ${blockIndex}`).toBeGreaterThanOrEqual(0);
    await caretTo(page, blockIndex, start);
    for (let step = 0; step < text.length; step++) await page.keyboard.press('Shift+ArrowRight');
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
  }).toPass({ timeout: 30_000 });
}

/** The text of the block the caret sits in, as the browser reports it. */
export function caretBlockText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const node = window.getSelection()?.anchorNode ?? null;
    const element = node instanceof Element ? node : (node?.parentElement ?? null);
    return element?.closest('[data-content-type]')?.textContent ?? null;
  });
}
