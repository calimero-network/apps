import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocTags } from '../DocTags';
import { TAG_COLORS, TAG_NEUTRAL, type Tag } from '@/lib/tags';
import { row } from '@/lib/workspaceIndex/__tests__/row';

let tags: Tag[] = [];
const createTag = vi.fn();
vi.mock('@/hooks/useTags', () => ({
  useTags: () => ({
    tags,
    byKey: new Map(tags.map((t) => [t.key, t])),
    createTag,
  }),
}));
const index = {
  rows: [
    row({ docId: 'a', tags: ['launch', 'roadmap'] }),
    row({ docId: 'b', tags: ['roadmap'] }),
  ],
};
vi.mock('@/context/WorkspaceIndexContext', () => ({
  useWorkspaceIndexValue: () => index,
}));

const onAdd = vi.fn();
const onRemove = vi.fn();

function mount(tagKeys: string[], canEdit = true) {
  return render(
    <DocTags
      tagKeys={tagKeys}
      canEdit={canEdit}
      onAdd={onAdd}
      onRemove={onRemove}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  tags = [
    { key: 'launch', name: 'launch', color: TAG_COLORS[0], deleted: false },
    { key: 'roadmap', name: 'roadmap', color: TAG_COLORS[1], deleted: false },
    { key: 'old', name: 'old', color: TAG_COLORS[2], deleted: true },
  ];
});

async function openPopover() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add tag' }));
  await screen.findByRole('combobox');
  return user;
}

describe('DocTags', () => {
  it('names chips from the registry, shows an unknown key as itself, hides a deleted tag (T-15)', () => {
    mount(['roadmap', 'unsynced', 'old']);
    expect(screen.getByText('roadmap')).toBeTruthy();
    expect(screen.getByText('unsynced')).toBeTruthy();
    expect(screen.queryByText('old')).toBeNull();
    const dots = screen.getAllByTestId('tag-dot');
    expect(dots[1].style.backgroundColor).toBe(hexToRgb(TAG_NEUTRAL));
  });

  it('offers no Add tag and no remove without edit rights (T-18, T-19)', () => {
    mount(['roadmap'], false);
    expect(screen.getByText('roadmap')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add tag' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove tag/ })).toBeNull();
  });

  it('removes a chip', async () => {
    const user = userEvent.setup();
    mount(['roadmap']);
    await user.click(screen.getByRole('button', { name: 'Remove tag roadmap' }));
    expect(onRemove).toHaveBeenCalledWith('roadmap');
  });

  it('suggests live tags not on the doc, with readable counts', async () => {
    mount(['roadmap']);
    await openPopover();
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['launch1 doc']);
  });

  it('picks an existing tag for a differently cased name instead of creating one (T-02)', async () => {
    mount([]);
    const user = await openPopover();
    await user.type(screen.getByRole('combobox'), 'Launch');
    expect(screen.queryByText(/Create tag/)).toBeNull();
    await user.keyboard('{Enter}');
    expect(onAdd).toHaveBeenCalledWith('launch');
    expect(createTag).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  });

  it('creates a new tag in the first unused colour, then adds it (T-03)', async () => {
    createTag.mockResolvedValue('q3-plan');
    mount([]);
    const user = await openPopover();
    await user.type(screen.getByRole('combobox'), '  Q3   plan ');
    const create = screen.getByRole('option', { name: 'Create tag “Q3 plan”' });
    expect(
      (screen.getByRole('radio', { name: 'Green' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    await user.click(create);
    expect(createTag).toHaveBeenCalledWith('Q3 plan', TAG_COLORS[2]);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('q3-plan'));
  });

  it('creates with the colour picked, and adds nothing when creating fails', async () => {
    createTag.mockRejectedValue(new Error('down'));
    mount([]);
    const user = await openPopover();
    await user.type(screen.getByRole('combobox'), 'Fresh');
    await user.click(screen.getByRole('radio', { name: 'Red' }));
    await user.click(screen.getByRole('option', { name: 'Create tag “Fresh”' }));
    expect(createTag).toHaveBeenCalledWith('Fresh', '#ef4444');
    await Promise.resolve();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('starts empty each time it opens', async () => {
    mount([]);
    const user = await openPopover();
    await user.type(screen.getByRole('combobox'), 'zz');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    await openPopover();
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('');
  });
});

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
