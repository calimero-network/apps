// Single recursive row in the FolderTree. Renders the folder's
// alias with an optional color chip and restricted-visibility lock
// icon, and recurses into its children. Selection is a controlled
// prop — parent owns the selectedId state.

import React from 'react';
import { ChevronRight, ChevronDown, Lock, Folder } from 'lucide-react';
import type { TreeNode } from '@/utils/ancestry';
import type { MergedFolder } from '@/hooks/useWorkspaceTree';

// Allowlist common CSS color formats before injecting into inline
// style. `folder.color` ultimately originates from registry WASM
// state that other peers can write, so we defence-in-depth against
// a malicious or compromised peer injecting arbitrary CSS values
// (e.g. `url(...)` / `var(...)` / multi-property payloads). React
// sets the style property via the DOM API which already mitigates
// XSS, but garbage values would still produce visual corruption.
// Tightened hex branch to only the valid CSS lengths (3, 4, 6, 8)
// — the {3,8} range accepts #12345 / #1234567 which aren't valid
// colors and would render as transparent. Rejecting them at the
// validator means the Folder fallback icon shows instead of a
// silent empty chip.
const COLOR_ALLOWLIST = /^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\([\d.,\s%/]+\)|hsla?\([\d.,\s%/]+\))$/;
function safeColor(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return COLOR_ALLOWLIST.test(trimmed) ? trimmed : undefined;
}

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
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            className="flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              // Only stop propagation when the button actually has
              // a toggle to perform; swallowing clicks on the leaf-
              // node spacer version of this button would make the
              // left-edge of a leaf row unclickable for selection.
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          // Inert spacer for leaf rows. A <span> doesn't intercept
          // the row-level onClick, so the full row stays clickable
          // for selection.
          <span className="inline-block h-4 w-4" aria-hidden />
        )}
        {(() => {
          const color = safeColor(folder?.color);
          return color ? (
            <span
              className="h-2.5 w-2.5 rounded-sm border border-border/50"
              style={{ backgroundColor: color }}
              aria-hidden
            />
          ) : (
            <Folder className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          );
        })()}
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
