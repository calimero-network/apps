import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { WorkspaceNav } from '../WorkspaceNav';
import { row } from '@/lib/workspaceIndex/__tests__/row';

const rows = [
  row({ docId: 'a', tags: ['q3', 'design'] }),
  row({ docId: 'b', tags: ['design'] }),
  row({ docId: 'c', tags: ['q3'], archived: true }),
];
const tags = [
  { key: 'q3', name: 'Q3', color: '#3b82f6', deleted: false },
  { key: 'design', name: 'Design', color: '#8b5cf6', deleted: false },
  { key: 'unused', name: 'Unused', color: '#10b981', deleted: false },
];

vi.mock('@/context/WorkspaceIndexContext', () => ({
  useWorkspaceIndexValue: () => ({ rows }),
}));
vi.mock('@/hooks/useTags', () => ({ useTags: () => ({ tags }) }));
vi.mock('@/components/folders/FolderTree', () => ({
  FolderTree: ({
    collapsed,
    onToggleCollapsed,
  }: {
    collapsed: boolean;
    onToggleCollapsed: () => void;
  }) => (
    <button aria-expanded={!collapsed} onClick={onToggleCollapsed}>
      Folders
    </button>
  ),
}));

let search = '';
function Probe() {
  search = useLocation().search;
  return null;
}

function mount(url: string, ws = 'ws1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/app/:ws/*"
          element={
            <>
              <WorkspaceNav
                ws={ws}
                selectedDocId={null}
                onSelectFolder={() => {}}
                onOpenDoc={() => {}}
                onNavigate={() => {}}
              />
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const section = (name: string) => screen.getByRole('button', { name });

beforeEach(() => localStorage.clear());

describe('WorkspaceNav', () => {
  it('counts readable, unarchived docs for Home and each tag, busiest tag first', () => {
    mount('/app/ws1');
    expect(screen.getByRole('button', { name: 'Home, 2' })).toBeTruthy();
    const tagRows = screen
      .getAllByRole('button', { name: /^(Design|Q3|Unused), / })
      .map((b) => b.getAttribute('aria-label'));
    expect(tagRows).toEqual(['Design, 2', 'Q3, 1']);
  });

  it('opens a tag as Home filtered to it, and marks that row, not Home', () => {
    const { unmount } = mount('/app/ws1');
    expect(
      screen
        .getByRole('button', { name: 'Home, 2' })
        .getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Q3, 1' }));
    expect(search).toBe('?tag=q3');
    unmount();

    mount('/app/ws1?tag=q3');
    expect(
      screen
        .getByRole('button', { name: 'Q3, 1' })
        .getAttribute('aria-current'),
    ).toBe('page');
    const home = screen.getByRole('button', { name: 'Home, 2' });
    expect(home.getAttribute('aria-current')).toBeNull();
  });

  it('marks nothing inside a folder', () => {
    mount('/app/ws1/f/f1');
    const home = screen.getByRole('button', { name: 'Home, 2' });
    expect(home.getAttribute('aria-current')).toBeNull();
  });

  it('offers no New view or New tag yet', () => {
    mount('/app/ws1');
    expect(screen.queryByRole('button', { name: 'New view' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New tag' })).toBeNull();
  });

  it('remembers collapsed sections per workspace', () => {
    const { unmount } = mount('/app/ws1');
    fireEvent.click(section('Tags'));
    fireEvent.click(section('Folders'));
    expect(screen.queryByRole('button', { name: 'Q3, 1' })).toBeNull();
    unmount();

    const view = mount('/app/ws1');
    expect(section('Tags').getAttribute('aria-expanded')).toBe('false');
    expect(section('Folders').getAttribute('aria-expanded')).toBe('false');
    expect(section('Views').getAttribute('aria-expanded')).toBe('true');
    view.unmount();

    mount('/app/ws2', 'ws2');
    expect(section('Tags').getAttribute('aria-expanded')).toBe('true');
  });
});
