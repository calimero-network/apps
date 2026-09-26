// Top-bar workspace switcher: the app's namespaces plus the create / join actions.
// namespaceId doubles as the root groupId under the current admin API.

import React, { useRef, useState } from 'react';
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
import { namespaceLabel } from '@/lib/namespaceLabel';
import { NamespaceCreateDialog } from './NamespaceCreateDialog';
import { NamespaceJoinDialog } from './NamespaceJoinDialog';

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
  // A menu hands focus back to its trigger as it closes, which lands AFTER a
  // dialog it opened has mounted, so the first keys typed into the dialog
  // went to the trigger (CI read "ed Without Clicking" for "Typed Without
  // Clicking"). The dialog returns focus to the trigger itself on close, so
  // skip the menu's own hand-back when an item opens one.
  const openingDialog = useRef(false);
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
            className="gap-1.5 px-2 data-[state=open]:bg-accent"
          >
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
          onCloseAutoFocus={(e) => {
            if (!openingDialog.current) return;
            openingDialog.current = false;
            e.preventDefault();
          }}
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
                      className="rounded-md"
                    >
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
            onSelect={() => {
              openingDialog.current = true;
              setShowCreate(true);
            }}
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
            New workspace
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2.5"
            onSelect={() => {
              openingDialog.current = true;
              setShowJoin(true);
            }}
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
