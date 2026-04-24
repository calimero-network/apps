// Root-to-leaf path above the selected folder. Pure presentational —
// clicking an ancestor selects it via the parent's onSelect callback.
//
// `ancestorsOf` returns the chain leaf-to-root; we reverse to render
// left-to-right (root first). The current folder is NOT rendered —
// WorkspaceLayout already shows it as the pane's <h1>, so including
// it here would produce a visible duplicate ("csc" in the breadcrumb
// right above "CSC" in the header). For a root-level folder with no
// ancestors, the whole breadcrumb collapses to nothing.

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ancestorsOf } from '@/utils/ancestry';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';

interface Props {
  folderId: string;
}

export function FolderBreadcrumb({ folderId }: Props) {
  const { folders } = useDriveWorkspace();
  const { setSelectedFolder } = useDriveWorkspace();

  const byId = React.useMemo(
    () => new Map(folders.map((f) => [f.id, f])),
    [folders],
  );
  const chain = React.useMemo(
    () =>
      ancestorsOf(
        folders.map((f) => ({ id: f.id, parent_id: f.parent_id })),
        folderId,
      ).reverse(),
    [folders, folderId],
  );

  if (chain.length === 0) return null;

  return (
    <nav
      aria-label="Folder breadcrumb"
      className="flex items-center gap-1 text-sm text-muted-foreground"
    >
      {chain.map((id, i) => {
        const f = byId.get(id);
        const isLast = i === chain.length - 1;
        return (
          <React.Fragment key={id}>
            <button
              type="button"
              className="truncate rounded px-1 py-0.5 hover:bg-muted hover:text-foreground"
              onClick={() => setSelectedFolder(id)}
            >
              {f?.alias ?? id.slice(0, 8)}
            </button>
            {!isLast && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
          </React.Fragment>
        );
      })}
      <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </nav>
  );
}
