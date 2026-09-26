// Root-to-leaf path above the selected folder. Pure presentational —
// clicking an ancestor selects it via the parent's onSelect callback.
//
// NOTE: As of the PR1 shell restructure this component is not currently
// rendered anywhere — the old folder-view pane that hosted it was
// replaced by the inline document editor. It is retained intentionally
// for PR2's EditorBreadcrumbBar (see the Notion-UX-redesign spec §1),
// which reuses it to show the folder path above the open document.
// Remove it only if that plan changes.
//
// `ancestorsOf` returns the chain leaf-to-root; we reverse to render
// left-to-right (root first). The current folder is NOT rendered — the
// caller is expected to show the active folder/document title
// separately, so including it here would produce a visible duplicate.
// For a root-level folder with no ancestors, the whole breadcrumb
// collapses to nothing.

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ancestorsOf } from '@/utils/ancestry';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';

interface Props {
  folderId: string;
}

export function FolderBreadcrumb({ folderId }: Props) {
  const { folders, setSelectedFolder } = useDriveWorkspace();

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
    </nav>
  );
}
