import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { row } from '@/lib/workspaceIndex/__tests__/row';
import {
  rowKey,
  type DocText,
  type FolderInfo,
  type IndexRow,
} from '@/lib/workspaceIndex/types';
import { dateLabel, updatedLabel } from '@/lib/relativeTime';
import { DocDetails } from '../DocDetails';

const BOB = 'b0'.repeat(32);
const ALICE = 'a1'.repeat(32);
const NOW = new Date(2026, 8, 28, 15, 30).getTime();
const MIN = 60_000;

const goDoc = vi.fn();
let rows: IndexRow[] = [];
let folders: FolderInfo[] = [];
let texts = new Map<string, DocText>();

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ws1',
    selfIdentity: ALICE,
    namespaceMemberNames: { [BOB]: 'Bob' },
  }),
}));
const CAROL = 'c2'.repeat(32);
vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: (_ns: string, id: string | null) => ({
    name: id === CAROL ? 'Carol' : null,
  }),
}));
vi.mock('@/context/WorkspaceIndexContext', () => ({
  useWorkspaceIndexValue: () => ({ rows, folders }),
  useTextIndexValue: () => ({ texts }),
}));
vi.mock('@/hooks/useTags', () => ({
  useTags: () => ({
    byKey: new Map([
      ['q3', { key: 'q3', name: 'Q3', color: '#3b82f6', deleted: false }],
    ]),
  }),
}));
vi.mock('@/hooks/useAppRoute', () => ({ useAppRoute: () => ({ goDoc }) }));
vi.mock('@/hooks/useNow', () => ({ useNow: () => NOW }));

function text(
  folderId: string,
  docId: string,
  links: DocText['links'],
): [string, DocText] {
  return [rowKey(folderId, docId), { folderId, docId, blocks: [], links }];
}

function link(
  folder: string,
  doc: string,
  sentence: string,
  extra: Partial<DocText['links'][number]> = {},
  ws = 'ws1',
): DocText['links'][number] {
  return {
    target: { ws, folder, doc },
    blockId: 'blk',
    sentence,
    linkRange: [0, 4],
    ...extra,
  };
}

const facts = () => screen.getAllByRole('definition').map((d) => d.textContent);
const section = (name: string) =>
  screen.getByRole('region', { name: new RegExp(name, 'i') });

function renderDetails(sheet = false) {
  return render(
    <DocDetails folderId="f1" docId="plan" sheet={sheet} onClose={() => {}} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  folders = [
    { id: 'f1', name: 'Product', color: '#10b981' },
    { id: 'f2', name: 'Marketing' },
  ];
  rows = [
    row({
      docId: 'plan',
      title: 'Plan',
      tags: ['q3'],
      createdAt: NOW - 30 * 24 * 60 * MIN,
      updatedAt: NOW - 2 * MIN,
      createdBy: ALICE,
      updatedBy: BOB,
    }),
    row({ folderId: 'f2', docId: 'blog', title: 'Launch blog' }),
    row({ docId: 'pricing', title: 'Pricing notes' }),
  ];
  texts = new Map();
});

describe('DocDetails (L-23)', () => {
  it('shows the folder, who created and updated the doc by name, and its tags', () => {
    renderDetails();
    const created = rows[0].createdAt;
    expect(facts()).toEqual([
      'Product',
      `${dateLabel(created, NOW)} by You`,
      `${updatedLabel(NOW - 2 * MIN, NOW)} by Bob`,
      'Q3',
    ]);
    expect(document.body.innerHTML).not.toContain(BOB);
  });

  it('names a member from their profile, and an unnamed one without their key', () => {
    const stranger = 'd3'.repeat(32);
    rows[0] = { ...rows[0], createdBy: CAROL, updatedBy: stranger };
    renderDetails();
    expect(facts().slice(1, 3)).toEqual([
      `${dateLabel(rows[0].createdAt, NOW)} by Carol`,
      `${updatedLabel(rows[0].updatedAt, NOW)} by Unnamed member`,
    ]);
    expect(document.body.innerHTML).not.toContain(stranger);
  });

  it('shows only the date when the author is unknown', () => {
    rows[0] = { ...rows[0], createdBy: '', updatedBy: '' };
    renderDetails();
    expect(facts().slice(1, 3)).toEqual([
      dateLabel(rows[0].createdAt, NOW),
      updatedLabel(rows[0].updatedAt, NOW),
    ]);
  });

  it('lists the docs linking here with their sentence, and only docs this device can read', () => {
    texts = new Map([
      text('f2', 'blog', [link('f1', 'plan', 'Plan is ready')]),
      text('f9', 'secret', [link('f1', 'plan', 'Plan leaked')]),
      text('f1', 'pricing', [link('f1', 'other', 'Not here')]),
    ]);
    renderDetails();
    const from = section('Linked from');
    expect(within(from).getByText('Launch blog')).toBeTruthy();
    expect(within(from).getByText('Plan').tagName).toBe('B');
    expect(from.textContent).not.toContain('leaked');
    expect(from.textContent).not.toContain('Pricing notes');
    fireEvent.click(within(from).getByRole('button', { name: /Launch blog/ }));
    expect(goDoc).toHaveBeenCalledWith('f2', 'blog', { block: undefined });
  });

  it('lists the readable docs this one links to, with the section of the link', () => {
    texts = new Map([
      text('f1', 'plan', [
        link('f1', 'pricing', 'see pricing', {
          section: 'Milestones',
          target: { ws: 'ws1', folder: 'f1', doc: 'pricing', block: 'b7' },
        }),
        link('f2', 'blog', 'the blog'),
        link('f9', 'secret', 'hidden'),
        link('f1', 'pricing', 'elsewhere', {}, 'ws2'),
      ]),
    ]);
    renderDetails();
    const to = section('Links to');
    const items = within(to).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Pricing notes'),
      expect.stringContaining('Launch blog'),
    ]);
    expect(items[0].textContent).toContain('Linked in “Milestones”');
    fireEvent.click(items[0]);
    expect(goDoc).toHaveBeenCalledWith('f1', 'pricing', { block: 'b7' });
  });

  it('lists the links of an archived doc, and backlinks from archived docs', () => {
    rows = rows.map((r) =>
      r.docId === 'plan' || r.docId === 'blog' ? { ...r, archived: true } : r,
    );
    texts = new Map([
      text('f1', 'plan', [link('f1', 'pricing', 'see pricing')]),
      text('f2', 'blog', [link('f1', 'plan', 'Plan is ready')]),
    ]);
    renderDetails();
    expect(within(section('Links to')).getByText('Pricing notes')).toBeTruthy();
    expect(within(section('Linked from')).getByText('Launch blog')).toBeTruthy();
  });

  it('follows the index as it changes (L-24)', () => {
    const view = renderDetails();
    expect(
      within(section('Linked from')).queryByText('Launch blog'),
    ).toBeNull();
    texts = new Map([
      text('f2', 'blog', [link('f1', 'plan', 'Plan is ready')]),
    ]);
    rows = rows.map((r) =>
      r.docId === 'plan' ? { ...r, updatedAt: NOW - 5 * MIN } : r,
    );
    view.rerender(
      <DocDetails
        folderId="f1"
        docId="plan"
        sheet={false}
        onClose={() => {}}
      />,
    );
    expect(
      within(section('Linked from')).getByText('Launch blog'),
    ).toBeTruthy();
    expect(facts()[2]).toBe(`${updatedLabel(NOW - 5 * MIN, NOW)} by Bob`);
  });

  it('opens as a sheet below md', () => {
    renderDetails(true);
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeTruthy();
  });
});
