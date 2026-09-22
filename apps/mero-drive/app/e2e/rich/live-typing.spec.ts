// Two people typing into one block at the same moment, each on their own node,
// with both nodes connected the whole time.

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/rich';
import { expectDigest, settle } from './helpers/converge';
import { PARAGRAPH, blockText, occurrences, sameCharacterCounts } from './helpers/doc-model';
import { caretTo, typeAt } from './helpers/editor';
import { blocksOnNode, passageCountOnNode } from './helpers/rpc';

const NODES = [1, 2];
const BASE = 'The fox.';
const ALICE = 'alicealice';
const BOB = 'bobbobbobb';
const KEY_DELAY_MS = 90; // human typing speed, so keystrokes and sync overlap

async function typeLive(page: Page, offset: number, text: string): Promise<void> {
  await caretTo(page, 0, offset);
  await page.keyboard.type(text, { delay: KEY_DELAY_MS });
}

/** What the window renders for the block, so drift from the node shows up. */
async function shownText(page: Page): Promise<string> {
  return (await page.getByTestId('doc-block').first().innerText()).replace(/\n/g, '');
}

test.describe('live typing', () => {
  test('two nodes typing at different spots keep both passages whole', async ({ rig }) => {
    const [a, b] = await rig.seed(NODES);
    await typeAt(a.page, 0, 0, BASE);
    await expectDigest(rig.doc, NODES, `${PARAGRAPH}{:${BASE}};`);

    await Promise.all([typeLive(a.page, BASE.length, ALICE), typeLive(b.page, 0, BOB)]);

    const digest = await settle(rig.doc, NODES);
    expect(digest).toBe(`${PARAGRAPH}{:${BOB}${BASE}${ALICE}};`);
    const [block] = await blocksOnNode(1, rig.doc);
    expect(await passageCountOnNode(1, rig.doc, block.id, ALICE)).toBe(1);
    expect(await passageCountOnNode(1, rig.doc, block.id, BOB)).toBe(1);
    await expect.poll(() => shownText(a.page), { timeout: 15_000 }).toBe(blockText(block));
    await expect.poll(() => shownText(b.page), { timeout: 15_000 }).toBe(blockText(block));
  });

  test('two nodes typing at the same spot lose and duplicate nothing', async ({ rig }) => {
    const [a, b] = await rig.seed(NODES);
    await typeAt(a.page, 0, 0, BASE);
    await expectDigest(rig.doc, NODES, `${PARAGRAPH}{:${BASE}};`);

    // Both carets start between "The" and " fox."; live keystrokes may
    // legitimately alternate here, so the claim is on characters, not runs.
    await Promise.all([typeLive(a.page, 3, ALICE), typeLive(b.page, 3, BOB)]);

    await settle(rig.doc, NODES);
    const [block] = await blocksOnNode(1, rig.doc);
    const text = blockText(block);
    expect(text.length).toBe(BASE.length + ALICE.length + BOB.length);
    expect(sameCharacterCounts(text, BASE + ALICE + BOB)).toBe(true);
    expect(text.startsWith('The')).toBe(true);
    expect(text.endsWith(' fox.')).toBe(true);
    expect(occurrences(text, ' fox.')).toBe(1);
    await expect.poll(() => shownText(a.page), { timeout: 15_000 }).toBe(text);
    await expect.poll(() => shownText(b.page), { timeout: 15_000 }).toBe(text);
  });
});
