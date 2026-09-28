// The link hover card: what it says for each target (from index data), and
// when it opens and closes under a mouse, a keyboard and a finger.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DocLinkHover, docLinkCardProps } from '../DocLinkHover';
import {
  rowKey,
  type DocText,
  type IndexRow,
  type Tag,
} from '@/lib/workspaceIndex/types';

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'w1',
    selfIdentity: 'me',
    namespaceMemberNames: {},
  }),
}));

const NOW = new Date(2026, 8, 28, 12, 0).getTime();
const MIN = 60_000;

const row: IndexRow = {
  folderId: 'f1',
  docId: 'd2',
  title: 'Pricing notes v2',
  tags: ['pricing', 'gone', 'raw'],
  archived: false,
  createdAt: 1,
  updatedAt: NOW - 2 * MIN,
  createdBy: 'me',
  updatedBy: 'alice',
};
const tags = new Map<string, Tag>([
  [
    'pricing',
    { key: 'pricing', name: 'pricing', color: '#ec4899', deleted: false },
  ],
  ['gone', { key: 'gone', name: 'gone', color: '#000', deleted: true }],
]);
const docText: DocText = {
  folderId: 'f1',
  docId: 'd2',
  blocks: [
    { id: 'b0', kind: 'paragraph', text: '  ' },
    { id: 'b1', kind: 'paragraph', text: 'Seat-based pricing does not fit.' },
    { id: 'b2', kind: 'paragraph', text: 'Later.' },
  ],
  links: [],
};

function data(over: Partial<Parameters<typeof docLinkCardProps>[1]> = {}) {
  return {
    ws: 'w1',
    index: {
      rows: [row],
      folders: [
        { id: 'f0', name: 'Product', color: '#3b82f6' },
        { id: 'f1', name: 'Pricing', parentId: 'f0' },
        { id: 'f3', name: 'Still syncing' },
      ],
      foldersKnown: true,
      folderStatus: { f0: 'ready', f1: 'ready', f3: 'syncing' } as const,
    },
    paths: new Map([
      [
        'f1',
        { names: ['Product', 'Pricing'], color: '#3b82f6', ids: ['f0', 'f1'] },
      ],
    ]),
    texts: new Map([[rowKey('f1', 'd2'), docText]]),
    tagsByKey: tags,
    personName: (id: string) => (id === 'alice' ? 'Alice' : 'You'),
    ...over,
  };
}

describe('docLinkCardProps (L-18 to L-22)', () => {
  const target = { ws: 'w1', folder: 'f1', doc: 'd2' };

  it('shows the live title, folder path, update, first line and live tags', () => {
    expect(docLinkCardProps(target, data(), NOW)).toEqual({
      state: 'ok',
      title: 'Pricing notes v2',
      folderPath: ['Product', 'Pricing'],
      folderColor: '#3b82f6',
      updatedLabel: '2 min ago by Alice',
      excerpt: 'Seat-based pricing does not fit.',
      tags: [
        { key: 'pricing', name: 'pricing', color: '#ec4899' },
        { key: 'raw', name: 'raw', color: undefined },
      ],
    });
  });

  it('leaves the excerpt out until the doc text is indexed', () => {
    const props = docLinkCardProps(target, data({ texts: new Map() }), NOW);
    expect(props.state === 'ok' && props.excerpt).toBeUndefined();
  });

  it('says the doc was deleted once its folder has loaded without it', () => {
    expect(docLinkCardProps({ ...target, doc: 'gone' }, data(), NOW)).toEqual({
      state: 'deleted',
    });
  });

  it('names no title for a folder this member cannot open', () => {
    expect(
      docLinkCardProps({ ...target, folder: 'secret' }, data(), NOW),
    ).toEqual({ state: 'no-access' });
  });

  it('flags another workspace', () => {
    expect(docLinkCardProps({ ...target, ws: 'w2' }, data(), NOW)).toEqual({
      state: 'other-workspace',
    });
  });

  it('keeps loading while the folder syncs or the folder list is unknown', () => {
    expect(docLinkCardProps({ ...target, folder: 'f3' }, data(), NOW)).toEqual({
      state: 'loading',
    });
    const unknown = data();
    unknown.index = { ...unknown.index, folders: [], foldersKnown: false };
    expect(docLinkCardProps(target, unknown, NOW)).toEqual({
      state: 'loading',
    });
  });
});

describe('DocLinkHover', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    render(
      <DocLinkHover>
        <p>
          See{' '}
          <a href="/app/w1/f/f1/d/d2" data-testid="doc">
            <b>Pricing</b>
          </a>{' '}
          and{' '}
          <a href="https://example.com" data-testid="web">
            web
          </a>
        </p>
      </DocLinkHover>,
    );
    return { doc: screen.getByTestId('doc'), web: screen.getByTestId('web') };
  }
  const card = () => screen.queryByTestId('doc-link-card');
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it('opens after the pointer rests on a doc link for 300 ms', () => {
    setup();
    fireEvent.pointerOver(screen.getByText('Pricing'), {
      pointerType: 'mouse',
    });
    advance(250);
    expect(card()).toBeNull();
    advance(60);
    expect(card()).not.toBeNull();
  });

  it('never opens for an external link or a touch', () => {
    const { doc, web } = setup();
    fireEvent.pointerOver(web, { pointerType: 'mouse' });
    fireEvent.pointerOver(doc, { pointerType: 'touch' });
    advance(1000);
    expect(card()).toBeNull();
  });

  it('does not open when the pointer only passes over', () => {
    const { doc } = setup();
    fireEvent.pointerOver(doc, { pointerType: 'mouse' });
    advance(100);
    fireEvent.pointerOut(doc, {
      pointerType: 'mouse',
      relatedTarget: document.body,
    });
    advance(1000);
    expect(card()).toBeNull();
  });

  it('stays open while the pointer moves from the link into the card', () => {
    const { doc } = setup();
    fireEvent.pointerOver(doc, { pointerType: 'mouse' });
    advance(300);
    fireEvent.pointerOut(doc, {
      pointerType: 'mouse',
      relatedTarget: document.body,
    });
    advance(80);
    fireEvent.pointerEnter(card()!, { pointerType: 'mouse' });
    advance(1000);
    expect(card()).not.toBeNull();
    fireEvent.pointerLeave(card()!, { pointerType: 'mouse' });
    advance(200);
    expect(card()).toBeNull();
  });

  it('closes after the grace period once the pointer leaves', () => {
    const { doc } = setup();
    fireEvent.pointerOver(doc, { pointerType: 'mouse' });
    advance(300);
    fireEvent.pointerOut(doc, {
      pointerType: 'mouse',
      relatedTarget: document.body,
    });
    advance(100);
    expect(card()).not.toBeNull();
    advance(100);
    expect(card()).toBeNull();
  });

  it('ignores moves between parts of the same link', () => {
    const { doc } = setup();
    fireEvent.pointerOver(doc, { pointerType: 'mouse' });
    advance(300);
    fireEvent.pointerOut(doc, {
      pointerType: 'mouse',
      relatedTarget: screen.getByText('Pricing'),
    });
    advance(1000);
    expect(card()).not.toBeNull();
  });

  it('opens on keyboard focus and closes on Escape', () => {
    const { doc } = setup();
    fireEvent.focus(doc);
    advance(300);
    expect(card()).not.toBeNull();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(card()).toBeNull();
  });

  it('closes when the link is clicked', () => {
    const { doc } = setup();
    fireEvent.pointerOver(doc, { pointerType: 'mouse' });
    advance(300);
    fireEvent.click(doc);
    expect(card()).toBeNull();
  });
});
