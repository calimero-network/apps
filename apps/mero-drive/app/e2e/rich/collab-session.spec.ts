// One editing session between two people, each on their own node, in one
// document: live typing, formatting, undo and redo, then edits made while cut
// off from each other. Every phase asserts what both nodes hold, exactly.

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/rich';
import { settle } from './helpers/converge';
import { blockText, occurrences, sameCharacterCounts, spanSummary } from './helpers/doc-model';
import { MOD, applyBold, applyItalic, caretBlockText, caretTo, redo, selectText, undo } from './helpers/editor';
import { switchNode } from './helpers/rig';
import { blocksOnNode } from './helpers/rpc';

const NODES = [1, 2];
const KEY_DELAY_MS = 90; // human typing speed, so keystrokes and sync overlap

async function caretToEnd(page: Page, block: number): Promise<void> {
  await caretTo(page, block, 0);
  await page.keyboard.press('End');
}

async function typeLive(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text, { delay: KEY_DELAY_MS });
}

/** Every block's text on a node, once both nodes hold one identical document. */
async function settledTexts(doc: Parameters<typeof settle>[0]): Promise<string[]> {
  await settle(doc, NODES);
  return (await blocksOnNode(1, doc)).map(blockText);
}

test('two people edit one document live, formatted, with undo, and apart', async ({ rig }) => {
  test.setTimeout(20 * 60_000);
  const [a, b] = await rig.seed(NODES);

  await test.step('seed four paragraphs', async () => {
    await caretTo(a.page, 0, 0);
    for (const [index, line] of ['The fox.', 'Notes:', 'Alice writes here.', 'Bob writes here.'].entries()) {
      if (index > 0) await a.page.keyboard.press('Enter');
      await a.page.keyboard.type(line);
    }
    expect(await settledTexts(rig.doc)).toEqual(['The fox.', 'Notes:', 'Alice writes here.', 'Bob writes here.']);
  });

  await test.step('live: both type into one paragraph at different spots', async () => {
    await Promise.all([
      (async () => {
        await caretToEnd(a.page, 0);
        await typeLive(a.page, ' It runs.');
      })(),
      (async () => {
        await caretTo(b.page, 0, 0);
        await typeLive(b.page, 'Look: ');
      })(),
    ]);
    const texts = await settledTexts(rig.doc);
    expect.soft(texts[0]).toBe('Look: The fox. It runs.');
  });

  await test.step('live: both type at the same spot and nothing is lost', async () => {
    await Promise.all([
      (async () => {
        await caretToEnd(a.page, 1);
        await typeLive(a.page, 'aaaa');
      })(),
      (async () => {
        await caretToEnd(b.page, 1);
        await typeLive(b.page, 'bbbb');
      })(),
    ]);
    const text = (await settledTexts(rig.doc))[1];
    // Keystrokes at one caret may alternate live; each one must land exactly once.
    expect.soft(text.length).toBe('Notes:'.length + 8);
    expect.soft(text.startsWith('Notes:')).toBe(true);
    expect.soft(sameCharacterCounts(text, 'Notes:aaaabbbb')).toBe(true);
  });

  await test.step('live: each writes their own paragraph at the same time', async () => {
    await Promise.all([
      (async () => {
        await caretToEnd(a.page, 2);
        await typeLive(a.page, ' More from Alice.');
      })(),
      (async () => {
        await caretToEnd(b.page, 3);
        await typeLive(b.page, ' More from Bob.');
      })(),
    ]);
    const texts = await settledTexts(rig.doc);
    expect.soft(texts[2]).toBe('Alice writes here. More from Alice.');
    expect.soft(texts[3]).toBe('Bob writes here. More from Bob.');
  });

  await test.step('rich: bold and italic by two people at once', async () => {
    await Promise.all([
      (async () => {
        await selectText(a.page, 2, 'Alice');
        await applyBold(a.page);
      })(),
      (async () => {
        await selectText(b.page, 3, 'Bob');
        await applyItalic(b.page);
      })(),
    ]);
    await settle(rig.doc, NODES);
    const blocks = await blocksOnNode(1, rig.doc);
    expect.soft(spanSummary(blocks[2])).toEqual(['bold=true:Alice', ': writes here. More from Alice.']);
    expect.soft(spanSummary(blocks[3])).toEqual(['italic=true:Bob', ': writes here. More from Bob.']);
    for (const page of [a.page, b.page]) {
      const editor = page.getByTestId('doc-editor');
      await expect.soft(editor.locator('strong', { hasText: 'Alice' })).toBeVisible();
      await expect.soft(editor.locator('em', { hasText: 'Bob' })).toBeVisible();
    }
  });

  await test.step('rich: one bolds a word while the other types in that paragraph', async () => {
    await Promise.all([
      (async () => {
        await selectText(a.page, 0, 'fox');
        await applyBold(a.page);
      })(),
      (async () => {
        await caretToEnd(b.page, 0);
        await typeLive(b.page, ' Fast.');
      })(),
    ]);
    await settle(rig.doc, NODES);
    const [first] = await blocksOnNode(1, rig.doc);
    expect.soft(spanSummary(first)).toEqual([':Look: The ', 'bold=true:fox', ':. It runs. Fast.']);
  });

  await test.step('rich: one makes a heading while the other types in it', async () => {
    await Promise.all([
      (async () => {
        await caretTo(b.page, 3, 0);
        await expect.poll(() => caretBlockText(b.page)).toContain('Bob writes here.');
        await b.page.keyboard.press(`${MOD}+Alt+1`);
        await expect.poll(() => caretBlockText(b.page)).toContain('Bob writes here.');
      })(),
      (async () => {
        await caretToEnd(a.page, 3);
        await typeLive(a.page, ' Done.');
      })(),
    ]);
    await settle(rig.doc, NODES);
    const blocks = await blocksOnNode(1, rig.doc);
    expect.soft(blocks[3].kind).toBe('heading');
    expect.soft(blockText(blocks[3])).toBe('Bob writes here. More from Bob. Done.');
    for (const page of [a.page, b.page]) {
      await expect
        .soft(page.getByTestId('doc-editor').locator('[data-content-type="heading"]', { hasText: 'Done.' }))
        .toBeVisible();
    }
  });

  await test.step('undo and redo take back only your own edit', async () => {
    await caretToEnd(a.page, 1);
    await a.page.keyboard.type(' mine');
    await caretToEnd(b.page, 0);
    await b.page.keyboard.type(' theirs');
    const before = await settledTexts(rig.doc);
    expect.soft(before[1].endsWith(' mine')).toBe(true);
    expect.soft(before[0].endsWith(' theirs')).toBe(true);

    await undo(a.page);
    const undone = await settledTexts(rig.doc);
    expect.soft(undone[1]).toBe(before[1].slice(0, -' mine'.length));
    expect.soft(undone[0]).toBe(before[0]);

    await redo(a.page);
    const redone = await settledTexts(rig.doc);
    expect.soft(redone).toEqual(before);
  });

  await test.step('apart: both cut off, each writes, then both rejoin', async () => {
    await switchNode(1, 'offline');
    await switchNode(2, 'offline');
    await caretToEnd(a.page, 2);
    await typeLive(a.page, ' Left side.');
    await caretToEnd(b.page, 2);
    await typeLive(b.page, ' Right side.');
    await switchNode(1, 'online');
    await switchNode(2, 'online');

    const text = (await settledTexts(rig.doc))[2];
    const tail = text.slice('Alice writes here. More from Alice.'.length);
    // Two runs appended at one spot: either order, never interleaved.
    expect.soft([' Left side. Right side.', ' Right side. Left side.']).toContain(tail);
    expect.soft(occurrences(text, ' Left side.')).toBe(1);
    expect.soft(occurrences(text, ' Right side.')).toBe(1);
  });
});
