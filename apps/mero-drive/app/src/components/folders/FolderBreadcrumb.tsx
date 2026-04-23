// Root-to-leaf path above the selected folder. Pure presentational —
// clicking an ancestor selects it via the parent's onSelect callback.
//
// `ancestorsOf` returns the chain leaf-to-root; we reverse to render
// left-to-right (root first). The current folder itself is rendered
// last with distinguishing font weight — not clickable since it's
// already selected.

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ancestorsOf } from '@/utils/ancestry';
import { useRegistry } from '@/context/RegistryContext';
import { useWorkspace } from '@/context/WorkspaceContext';

interface Props {
  folderId: string;
}

export function FolderBreadcrumb({ folderId }: Props) {
  const { folders } = useRegistry();
  const { setSelectedFolder } = useWorkspace();

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

  const current = byId.get(folderId);

  return (
    <nav
      aria-label="Folder breadcrumb"
      className="flex items-center gap-1 text-sm text-muted-foreground"
    >
      {chain.map((id) => {
        const f = byId.get(id);
        return (
          <React.Fragment key={id}>
            <button
              type="button"
              className="truncate rounded px-1 py-0.5 hover:bg-muted hover:text-foreground"
              onClick={() => setSelectedFolder(id)}
            >
              {f?.alias ?? id.slice(0, 8)}
            </button>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </React.Fragment>
        );
      })}
      <span className="truncate px-1 font-medium text-foreground">
        {current?.alias ?? folderId.slice(0, 8)}
      </span>
    </nav>
  );
}
