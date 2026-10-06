// The link hover card: what it says for each target (from index data), and
// when it opens and closes under a mouse, a keyboard and a finger.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  DocAwareLinkToolbar,
  DocLinkHover,
  docLinkCardProps,
} from '../DocLinkHover';
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
    namespaceMemberNames: { [BOB]: 'Robert' },
    namespaceMembers: {
      members: [{ identity: 'me' }, { identity: BOB, role: 'Admin' }],
      loading: false,
      error: null,
    },
  }),
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: () => ({ name: null }),
}));
const BOB = 'b0'.repeat(32);
const canOpen = vi.fn<(member: string) => boolean | undefined>(() => true);
vi.mock('@/hooks/useAppRoute', () => ({
  useAppRoute: () => ({ route: { ws: 'w1', folder: 'f1', doc: 'd1' } }),
}));
vi.mock('@blocknote/react', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBlockNoteEditor: () => ({
    prosemirrorState: { selection: { from: 12, to: 12 } },
  }),
  LinkToolbar: () => <div data-testid="bn-link-toolbar" />,
}));
vi.mock('@/hooks/useFolderReach', () => ({
  useFolderReach: () => canOpen,
}));
vi.mock('@calimero-network/mero-react', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // A one-off member read goes stale when someone joins; the card must not use it.
  useGroupMembers: () => ({ members: [] }),
  useGroupCapabilities: () => ({ capabilities: null }),
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
  mentions: [],
};

const refetchFolder = vi.fn();

function data(over: Partial<Parameters<typeof docLinkCardProps>[1]> = {}) {
  return {
    ws: 'w1',
    registryFolders: ['f0', 'f1', 'f3', 'f4', 'secret'].map((id) => ({ id })),
    index: {
      rows: [row],
      folders: [
        { id: 'f0', name: 'Product', color: '#3b82f6' },
        { id: 'f1', name: 'Pricing', parentId: 'f0' },
        { id: 'f3', name: 'Still syncing' },
        { id: 'f4', name: 'Unreadable' },
      ],
      foldersKnown: true,
      folderStatus: {
        f0: 'ready',
        f1: 'ready',
        f3: 'syncing',
        f4: 'error',
      } as const,
      refetchFolder,
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

  // Gone and Restricted-to-others look the same from here, so neither is named.
  it('says only that the doc is unavailable when its folder is not listed', () => {
    expect(
      docLinkCardProps({ ...target, folder: 'gone' }, data(), NOW),
    ).toEqual({ state: 'no-access' });
  });

  it('says a folder that failed to load is unavailable, with a retry', () => {
    const props = docLinkCardProps({ ...target, folder: 'f4' }, data(), NOW);
    expect(props.state).toBe('unavailable');
    if (props.state === 'unavailable') props.onRetry?.();
    expect(refetchFolder).toHaveBeenCalledWith('f4');
  });

  it('keeps loading until the workspace and its folders are known', () => {
    expect(docLinkCardProps(target, data({ ws: null }), NOW)).toEqual({
      state: 'loading',
    });
    expect(
      docLinkCardProps(target, data({ registryFolders: null }), NOW),
    ).toEqual({ state: 'loading' });
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
  beforeEach(() => {
    vi.useFakeTimers();
    canOpen.mockReturnValue(true);
  });
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
          </a>{' '}
          and{' '}
          <a href={`/app/w1/m/${BOB}`} data-testid="mention">
            Bob
          </a>
        </p>
      </DocLinkHover>,
    );
    return {
      doc: screen.getByTestId('doc'),
      web: screen.getByTestId('web'),
      mention: screen.getByTestId('mention'),
    };
  }
  const card = () => screen.queryByTestId('doc-link-card');
  const memberCard = () => screen.queryByTestId('member-card');
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

  it('opens a mention card with the member name today and their role', () => {
    const { mention } = setup();
    fireEvent.pointerOver(mention, { pointerType: 'mouse' });
    advance(300);
    expect(memberCard()?.textContent).toBe('RORobertAdminCan open this folder');
    expect(card()).toBeNull();
  });

  it('opens a mention card at once on click, and says when they cannot open the folder', () => {
    canOpen.mockReturnValue(false);
    const { mention } = setup();
    fireEvent.click(mention);
    expect(memberCard()?.textContent).toContain("Can't open this folder");
  });

  it('stays open when the card itself is clicked', () => {
    const { doc } = setup();
    fireEvent.pointerOver(doc, { pointerType: 'mouse' });
    advance(300);
    fireEvent.click(card()!);
    expect(card()).not.toBeNull();
  });
});

describe('DocAwareLinkToolbar', () => {
  // The caret sits inside the link, as after a click on it.
  const props = (url: string) =>
    ({ url, text: 'x', range: { from: 10, to: 20 } }) as unknown as Parameters<
      typeof DocAwareLinkToolbar
    >[0];
  const toolbar = () => screen.queryByTestId('bn-link-toolbar');

  it('never offers the link toolbar on a mention, whose Open would leave the doc', () => {
    render(<DocAwareLinkToolbar {...props(`/app/w1/m/${BOB}`)} />);
    expect(toolbar()).toBeNull();
  });

  it('keeps it for a doc link or a web link with the caret inside', () => {
    const { unmount } = render(
      <DocAwareLinkToolbar {...props('/app/w1/f/f1/d/d2')} />,
    );
    expect(toolbar()).not.toBeNull();
    unmount();
    render(<DocAwareLinkToolbar {...props('https://example.com')} />);
    expect(toolbar()).not.toBeNull();
  });
});
