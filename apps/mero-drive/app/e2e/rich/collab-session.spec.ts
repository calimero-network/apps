// One editing session between two people, each on their own node, in one
// document: live typing, formatting, undo and redo, then edits made while cut
// off from each other. Every phase asserts what both nodes hold, exactly.

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/rich';
import { expectDigest, settle } from './helpers/converge';
import { blockText, occurrences, sameCharacterCounts, spanSummary } from './helpers/doc-model';
import { MOD, applyBold, applyItalic, caretBlockText, caretTo, caretToEnd, redo, selectText, undo, titleInput } from './helpers/editor';
import { switchNode } from './helpers/rig';
import { addExplicitMember, blocksOnNode, digestOnNode, ownedIdentity, titleOnNode } from './helpers/rpc';

const NODES = [1, 2];
const KEY_DELAY_MS = 90; // human typing speed, so keystrokes and sync overlap
const EMOJI = ` ${String.fromCodePoint(0x1f600)} ${String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)}`;
const PASTE = 'abcdefghij'.repeat(500); // 5000 characters in one editor change
const NEW_UNDO_STEP_MS = 1000; // past the editors' 500 ms grouping, so the next edit undoes on its own

async function typeLive(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text, { delay: KEY_DELAY_MS });
}

/** Each rendered line of a window's editor. */
async function shownLines(page: Page): Promise<string[]> {
  const text = await page.getByTestId('doc-editor').innerText();
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Every block's text once both nodes hold one document and both windows show it. */
async function settledTexts(doc: Parameters<typeof settle>[0], pages: Page[]): Promise<string[]> {
  await settle(doc, NODES);
  const texts = (await blocksOnNode(1, doc)).map(blockText);
  const lines = texts.map((text) => text.trim()).filter(Boolean);
  for (const page of pages) {
    await expect.poll(() => shownLines(page), { timeout: 30_000 }).toEqual(lines);
  }
  return texts;
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
    expect(await settledTexts(rig.doc, [a.page, b.page])).toEqual(['The fox.', 'Notes:', 'Alice writes here.', 'Bob writes here.']);
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
    const texts = await settledTexts(rig.doc, [a.page, b.page]);
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
    const text = (await settledTexts(rig.doc, [a.page, b.page]))[1];
    // Each person's caret stays after their own last keystroke, so both runs
    // stay whole: either order, never alternating.
    expect.soft(sameCharacterCounts(text, 'Notes:aaaabbbb')).toBe(true);
    expect.soft(['Notes:aaaabbbb', 'Notes:bbbbaaaa']).toContain(text);
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
    const texts = await settledTexts(rig.doc, [a.page, b.page]);
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
    const before = await settledTexts(rig.doc, [a.page, b.page]);
    expect.soft(before[1].endsWith(' mine')).toBe(true);
    expect.soft(before[0].endsWith(' theirs')).toBe(true);

    await undo(a.page);
    const undone = await settledTexts(rig.doc, [a.page, b.page]);
    expect.soft(undone[1]).toBe(before[1].slice(0, -' mine'.length));
    expect.soft(undone[0]).toBe(before[0]);

    await redo(a.page);
    const redone = await settledTexts(rig.doc, [a.page, b.page]);
    expect.soft(redone).toEqual(before);

    await caretToEnd(a.page, 1);
    await a.page.keyboard.press(`${MOD}+z`);
    expect.soft(await settledTexts(rig.doc, [a.page, b.page])).toEqual(undone);
    await a.page.keyboard.press(`${MOD}+Shift+z`);
    expect.soft(await settledTexts(rig.doc, [a.page, b.page])).toEqual(before);
  });

  await test.step('title: both type into the title at once', async () => {
    const title = await titleOnNode(1, rig.doc);
    await Promise.all([
      (async () => {
        await titleInput(a.page).click();
        await titleInput(a.page).press('End');
        await typeLive(a.page, ' draft');
      })(),
      (async () => {
        await titleInput(b.page).click();
        await titleInput(b.page).press('Home');
        await typeLive(b.page, 'Team ');
      })(),
    ]);
    const expected = `Team ${title} draft`;
    await expect.poll(() => titleOnNode(1, rig.doc), { timeout: 60_000 }).toBe(expected);
    await expect.poll(() => titleOnNode(2, rig.doc), { timeout: 60_000 }).toBe(expected);
    for (const page of [a.page, b.page]) {
      await expect.soft(titleInput(page)).toHaveValue(expected, { timeout: 15_000 });
    }
  });

  await test.step('title: undo takes back only your own words, after the other edits too', async () => {
    const title = await titleOnNode(1, rig.doc);
    await a.page.waitForTimeout(NEW_UNDO_STEP_MS);
    await titleInput(a.page).click();
    await titleInput(a.page).press('End');
    await typeLive(a.page, ' v2');
    await expect.poll(() => titleOnNode(2, rig.doc), { timeout: 60_000 }).toBe(`${title} v2`);
    await titleInput(b.page).click();
    await titleInput(b.page).press('Home');
    await typeLive(b.page, 'Our ');
    await expect(titleInput(a.page)).toHaveValue(`Our ${title} v2`, { timeout: 30_000 });

    // A peer's change resets the input, so this is the title's own history, not the browser's.
    await titleInput(a.page).press(`${MOD}+z`);
    await expect.poll(() => titleOnNode(2, rig.doc), { timeout: 30_000 }).toBe(`Our ${title}`);
    await expect.soft(titleInput(b.page)).toHaveValue(`Our ${title}`, { timeout: 15_000 });
    await titleInput(a.page).press(`${MOD}+Shift+z`);
    await expect.poll(() => titleOnNode(2, rig.doc), { timeout: 30_000 }).toBe(`Our ${title} v2`);
  });

  await test.step('blocks: Enter splits and Backspace merges while the other types', async () => {
    await caretToEnd(a.page, 3);
    await a.page.keyboard.press('Enter');
    await a.page.keyboard.type('Split me here please.');
    expect.soft((await settledTexts(rig.doc, [a.page, b.page]))[4]).toBe('Split me here please.');

    await Promise.all([
      (async () => {
        await caretTo(a.page, 4, 8);
        await a.page.keyboard.press('Enter');
      })(),
      (async () => {
        await caretToEnd(b.page, 1);
        await typeLive(b.page, ' live');
      })(),
    ]);
    const split = await settledTexts(rig.doc, [a.page, b.page]);
    expect.soft(split[4]).toBe('Split me');
    expect.soft(split[5]).toBe(' here please.');
    expect.soft(split[1].endsWith(' live')).toBe(true);

    await caretTo(a.page, 5, 0);
    await a.page.keyboard.press('Backspace');
    const merged = await settledTexts(rig.doc, [a.page, b.page]);
    expect.soft(merged[4]).toBe('Split me here please.');
    expect.soft(merged.length).toBe(5);
  });

  await test.step('unicode: emoji and a ZWJ family land exactly as typed', async () => {
    await caretToEnd(b.page, 4);
    await b.page.keyboard.insertText(EMOJI);
    expect.soft((await settledTexts(rig.doc, [a.page, b.page]))[4]).toBe(`Split me here please.${EMOJI}`);
  });

  await test.step('large: a 5000-character paste lands whole in one block', async () => {
    await caretToEnd(a.page, 4);
    await a.page.keyboard.press('Enter');
    await a.page.keyboard.insertText(PASTE);
    const texts = await settledTexts(rig.doc, [a.page, b.page]);
    expect.soft(texts[5]).toBe(PASTE);
    expect.soft(texts.length).toBe(6);
  });

  await test.step('cursors: each window shows the other caret and selection', async () => {
    // Presence is sealed with the folder's group key, which an Open folder's
    // inherited member never receives; setup grants explicit membership.
    await addExplicitMember(1, rig.doc.contextId, await ownedIdentity(2, rig.doc.contextId));
    await caretTo(a.page, 0, 4);
    await expect.soft(b.page.getByTestId('doc-editor').getByTestId('presence-cursor')).toHaveCount(1, { timeout: 90_000 });
    await selectText(a.page, 0, 'fox');
    await expect.soft(b.page.getByTestId('doc-editor').getByTestId('presence-selection')).toHaveCount(1, { timeout: 15_000 });
    await caretTo(b.page, 1, 2);
    await expect.soft(a.page.getByTestId('doc-editor').getByTestId('presence-cursor')).toHaveCount(1, { timeout: 15_000 });
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

    const text = (await settledTexts(rig.doc, [a.page, b.page]))[2];
    const tail = text.slice('Alice writes here. More from Alice.'.length);
    // Two runs appended at one spot: either order, never interleaved.
    expect.soft([' Left side. Right side.', ' Right side. Left side.']).toContain(tail);
    expect.soft(occurrences(text, ' Left side.')).toBe(1);
    expect.soft(occurrences(text, ' Right side.')).toBe(1);
  });

  await test.step('late joiner: a third node opens the document and reads it identically', async () => {
    const digest = await settle(rig.doc, NODES);
    await rig.join(3);
    await expectDigest(rig.doc, [3], digest);
    expect.soft(await digestOnNode(3, rig.doc)).toBe(digest);
  });
});
