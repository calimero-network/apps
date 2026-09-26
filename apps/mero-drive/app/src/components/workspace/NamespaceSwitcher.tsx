// Top-bar workspace switcher: the app's namespaces plus the create / join actions.
// namespaceId doubles as the root groupId under the current admin API.

import React, { useState } from 'react';
import { ChevronsUpDown, Link, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { initials } from '@/lib/initials';
import { namespaceLabel } from '@/lib/namespaceLabel';
import { NamespaceCreateDialog } from './NamespaceCreateDialog';
import { NamespaceJoinDialog } from './NamespaceJoinDialog';

function WorkspaceTile({ label }: { label: string | null }) {
  return label ? (
    <span
      aria-hidden
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border border-border bg-secondary text-[10px] font-bold text-secondary-foreground"
    >
      {initials(label)}
    </span>
  ) : (
    <span
      aria-hidden
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border border-dashed border-muted-foreground/50 text-muted-foreground"
    >
      <Plus className="!size-3" />
    </span>
  );
}

export function NamespaceSwitcher() {
  const {
    namespaces,
    selectedNamespaceId,
    selectNamespace,
    loading,
    error,
    refetch,
  } = useDriveWorkspace();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  if (loading && namespaces.length === 0) {
    return (
      <div className="px-3 py-1.5 text-sm text-muted-foreground">
        Loading workspaces…
      </div>
    );
  }

  if (error && namespaces.length === 0) {
    return (
      <div
        className="px-3 py-1.5 text-sm text-destructive"
        title={error.message}
      >
        Failed to load workspaces
      </div>
    );
  }

  const current = namespaces.find((n) => n.namespaceId === selectedNamespaceId);
  const currentLabel = current
    ? namespaceLabel(current.namespaceId, current.name)
    : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            data-testid="workspace-switcher"
            className="gap-2 px-1.5 data-[state=open]:bg-accent"
          >
            <WorkspaceTile label={currentLabel} />
            {currentLabel ? (
              <span className="max-w-[24ch] truncate">{currentLabel}</span>
            ) : (
              <span className="font-normal text-muted-foreground">
                No workspace
              </span>
            )}
            <ChevronsUpDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="flex max-h-[var(--radix-dropdown-menu-content-available-height)] w-72 flex-col rounded-lg p-1 shadow-lg"
        >
          {namespaces.length > 0 && (
            <>
              <DropdownMenuLabel className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Workspaces
              </DropdownMenuLabel>
              {/* Only the list scrolls, so the create / join actions stay reachable. */}
              <DropdownMenuRadioGroup
                value={selectedNamespaceId ?? ''}
                onValueChange={selectNamespace}
                className="min-h-0 max-h-80 overflow-y-auto"
              >
                {namespaces.map((n) => {
                  const label = namespaceLabel(n.namespaceId, n.name);
                  return (
                    <DropdownMenuRadioItem
                      key={n.namespaceId}
                      value={n.namespaceId}
                      textValue={label}
                      className="gap-2.5 rounded-md"
                    >
                      <WorkspaceTile label={label} />
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block truncate">{label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {n.memberCount} member{n.memberCount === 1 ? '' : 's'}
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator className="bg-border" />
            </>
          )}
          <DropdownMenuItem
            className="gap-2.5"
            onSelect={() => setShowCreate(true)}
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
            New workspace
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2.5"
            onSelect={() => setShowJoin(true)}
          >
            <Link className="h-4 w-4 text-muted-foreground" />
            Join with invite link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {showCreate && (
        <NamespaceCreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            await refetch();
          }}
        />
      )}
      {showJoin && (
        <NamespaceJoinDialog
          onClose={() => setShowJoin(false)}
          onJoined={async () => {
            await refetch();
          }}
        />
      )}
    </>
  );
}
