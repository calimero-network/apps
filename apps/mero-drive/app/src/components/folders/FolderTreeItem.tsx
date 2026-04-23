// Single recursive row in the FolderTree. Renders the folder's
// alias with an optional color chip and restricted-visibility lock
// icon, and recurses into its children. Selection is a controlled
// prop — parent owns the selectedId state.

import React from 'react';
import { ChevronRight, ChevronDown, Lock, Folder } from 'lucide-react';
import type { TreeNode } from '@/utils/ancestry';
import type { MergedFolder } from '@/hooks/useWorkspaceTree';

interface Props {
  node: TreeNode;
  byId: Map<string, MergedFolder>;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FolderTreeItem({
  node,
  byId,
  depth,
  selectedId,
  onSelect,
}: Props) {
  const folder = byId.get(node.id);
  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = React.useState(true);

  return (
    <li>
      <div
        className={`flex items-center gap-1.5 rounded px-2 py-1 text-sm cursor-pointer ${
          isSelected
            ? 'bg-primary/10 text-primary'
            : 'text-foreground hover:bg-muted'
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node.id)}
      >
        <button
          type="button"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className="flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded((v) => !v);
          }}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="h-3.5 w-3.5" />
          )}
        </button>
        {folder?.color ? (
          <span
            className="h-2.5 w-2.5 rounded-sm border border-border/50"
            style={{ backgroundColor: folder.color }}
            aria-hidden
          />
        ) : (
          <Folder className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        )}
        <span className="flex-1 truncate">
          {folder?.alias ?? node.id.slice(0, 8)}
        </span>
        {folder?.visibility === 'Restricted' && (
          <Lock
            className="h-3 w-3 text-muted-foreground"
            aria-label="Restricted"
          />
        )}
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map((c) => (
            <FolderTreeItem
              key={c.id}
              node={c}
              byId={byId}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
