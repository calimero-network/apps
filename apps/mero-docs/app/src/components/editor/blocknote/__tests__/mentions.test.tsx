// Mentioning a member from the @ picker: who is offered, in what order, and
// what a pick puts in the document.
import { describe, expect, it, vi } from 'vitest';
import { editorWith } from './editorTyping';
import {
  CANT_OPEN_FOLDER,
  mentionPickerItems,
  peopleItems,
  pickLinkItem,
  recentPeople,
} from '../mentions';
import {
  rowKey,
  type DocText,
  type IndexRow,
} from '@/lib/workspaceIndex/types';

const ME = 'a1'.repeat(32);
const ADA = 'ad'.repeat(32);
const BOB = 'b0'.repeat(32);
const CHLOE = 'c0'.repeat(32);
const ZOE = 'e0'.repeat(32);
const NAMES: Record<string, string> = {
  [ME]: 'Mia',
  [ADA]: 'Ada Lovelace',
  [BOB]: 'Bob',
  [CHLOE]: 'Chloé',
  [ZOE]: 'Zoe',
};

function people(over: Partial<Parameters<typeof peopleItems>[1]> = {}) {
  return {
    ws: 'w1',
    self: ME,
    members: [ME, ADA, BOB, CHLOE, ZOE],
    names: NAMES,
    workedWith: [],
    canOpen: () => true,
    ...over,
  };
}

function row(docId: string, over: Partial<IndexRow> = {}): IndexRow {
  return {
    folderId: 'f1',
    docId,
    title: docId,
    tags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    createdBy: ME,
    updatedBy: ME,
    ...over,
  };
}

describe('peopleItems', () => {
  it('names members, you as You, never by key, and links each to their member URL', () => {
    const items = peopleItems('', people());
    expect(items.map((i) => i.title)).toEqual([
      'Ada Lovelace',
      'Bob',
      'Chloé',
      'Zoe',
      'You',
    ]);
    expect(
      items.every((i) => i.kind === 'person' && i.group === 'People'),
    ).toBe(true);
    expect(items[0].href).toBe(`/app/w1/m/${ADA}`);
    expect(items.some((i) => i.title.includes(ADA.slice(0, 8)))).toBe(false);
  });

  it('puts people you worked with first before anything is typed, capped at five', () => {
    const more = [...Array(6)].map((_, i) => `f${i}`.padEnd(64, '0'));
    const items = peopleItems(
      '',
      people({ members: [ME, ADA, BOB, ZOE, ...more], workedWith: [ZOE, BOB] }),
    );
    expect(items).toHaveLength(5);
    expect(items.slice(0, 3).map((i) => i.title)).toEqual([
      'Zoe',
      'Bob',
      'Ada Lovelace',
    ]);
  });

  it('matches names folding case and accents, best match first', () => {
    expect(peopleItems('chloe', people()).map((i) => i.title)).toEqual([
      'Chloé',
    ]);
    const lo = peopleItems('lo', people());
    expect(lo.map((i) => i.title)).toEqual(['Ada Lovelace', 'Chloé']);
    expect(lo[0].titleRanges).toEqual([{ start: 4, end: 6 }]);
  });

  it('forgives a typo in a name', () => {
    const ALICE = 'a2'.repeat(32);
    const items = peopleItems(
      'alce',
      people({
        members: [ME, ADA, ALICE],
        names: { ...NAMES, [ALICE]: 'Alice' },
      }),
    );
    expect(items.map((i) => i.title)).toEqual(['Alice']);
    expect(items[0].titleRanges).toEqual([{ start: 0, end: 5 }]);
  });

  it('finds you by your own name or by You', () => {
    expect(peopleItems('mi', people()).map((i) => i.title)).toEqual(['You']);
    expect(peopleItems('you', people()).map((i) => i.title)).toEqual(['You']);
  });

  it('says when a member cannot open the folder of the doc being edited', () => {
    const items = peopleItems(
      'bo',
      people({ canOpen: (id) => (id === BOB ? false : undefined) }),
    );
    expect(items[0].folderLabel).toBe(CANT_OPEN_FOLDER);
    expect(items[0].mention).toEqual({ name: 'Bob', cantOpen: true });
    const unknown = peopleItems('ada', people({ canOpen: () => undefined }));
    expect(unknown[0].folderLabel).toBe('');
    expect(unknown[0].mention?.cantOpen).toBe(false);
  });
});

describe('recentPeople', () => {
  it('lists members mentioned in the open doc, then people here, then recent authors', () => {
    const current = rowKey('f1', 'open');
    const text: DocText = {
      folderId: 'f1',
      docId: 'open',
      blocks: [],
      links: [],
      mentions: [{ ws: 'w1', member: CHLOE, blockId: 'b', sentence: '' }],
    };
    const rows = [
      row('old', { updatedAt: 1, updatedBy: ADA, createdBy: ME }),
      row('new', { updatedAt: 9, updatedBy: ZOE, createdBy: ADA }),
    ];
    expect(
      recentPeople(current, new Map([[current, text]]), [BOB], rows),
    ).toEqual([CHLOE, BOB, ZOE, ADA, ME]);
  });
});

describe('mentionPickerItems', () => {
  it('shows People, then Documents, five of each before anything is typed', () => {
    const rows = [...Array(7)].map((_, i) =>
      row(`d${i}`, { title: `Doc ${i}`, updatedAt: i }),
    );
    const items = mentionPickerItems('', {
      ...people(),
      rows,
      texts: new Map(),
      paths: new Map(),
    });
    expect(items.map((i) => i.group)).toEqual([
      ...Array(5).fill('People'),
      ...Array(5).fill('Documents'),
    ]);
  });

  it('offers typos only when nothing in the menu matches exactly', () => {
    const DANA = 'a3'.repeat(32);
    const src = (rows: IndexRow[]) => ({
      ...people({ members: [ME, DANA], names: { ...NAMES, [DANA]: 'Dana' } }),
      rows,
      texts: new Map<string, DocText>(),
      paths: new Map(),
    });
    const titles = (rows: IndexRow[]) =>
      mentionPickerItems('data', src(rows)).map((i) => i.title);
    expect(titles([row('d1', { title: 'Data plan' })])).toEqual(['Data plan']);
    expect(titles([row('d1', { title: 'Budget' })])).toEqual(['Dana']);
    const dana = mentionPickerItems(
      'dana',
      src([row('d1', { title: 'Data plan' })]),
    );
    expect(dana.map((i) => i.title)).toEqual(['Dana']);
  });
});

describe('pickLinkItem', () => {
  it('inserts the name linked to the member and warns when they cannot open the folder', () => {
    const editor = editorWith('ask ');
    const notify = vi.fn();
    const [bob] = peopleItems('bob', people({ canOpen: (id) => id !== BOB }));
    pickLinkItem(editor, bob, notify);
    expect(editor.document[0].content).toEqual([
      { type: 'text', text: 'ask ', styles: {} },
      {
        type: 'link',
        href: `/app/w1/m/${BOB}`,
        content: [{ type: 'text', text: 'Bob', styles: {} }],
      },
    ]);
    expect(notify).toHaveBeenCalledWith("Bob can't open this folder");
  });

  it('inserts your own name, not You, and a doc by its title, without a warning', () => {
    const editor = editorWith('');
    const notify = vi.fn();
    const [me] = peopleItems('you', people());
    pickLinkItem(editor, me, notify);
    pickLinkItem(
      editor,
      {
        id: 'doc:f1/d2',
        kind: 'doc',
        title: 'Plan',
        folderLabel: '',
        href: '/app/w1/f/f1/d/d2',
      },
      notify,
    );
    expect(
      (editor.document[0].content as { content: { text: string }[] }[]).map(
        (l) => l.content[0].text,
      ),
    ).toEqual(['Mia', 'Plan']);
    expect(notify).not.toHaveBeenCalled();
  });
});
