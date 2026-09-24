// Top-bar workspace switcher. One trigger showing the active workspace;
// its menu lists every namespace for this application (from
// useDriveWorkspace — which reads `useNamespacesForApplication`
// internally) plus the create / join actions.
//
// namespaceId doubles as the root groupId under the current admin
// API (it's the parent groupId for createGroupInNamespace,
// useSubgroups, etc.) — useDriveWorkspace exposes both fields but
// derives `rootGroupId` from `selectedNamespaceId` directly.

import React, { useState } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronsUpDown, Link, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { NamespaceCreateDialog } from './NamespaceCreateDialog';
import { NamespaceJoinDialog } from './NamespaceJoinDialog';

function workspaceLabel(n: { name?: string | null; namespaceId: string }) {
  return n.name ?? n.namespaceId.slice(0, 8);
}

function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? words[0][0] + words[1][0] : label.slice(0, 2);
  return letters.toUpperCase();
}

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
  const currentLabel = current ? workspaceLabel(current) : null;

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
          className="w-72 rounded-lg p-1 shadow-lg"
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
                className="max-h-[min(20rem,calc(var(--radix-dropdown-menu-content-available-height)_-_6rem))] overflow-y-auto"
              >
                {namespaces.map((n) => {
                  const label = workspaceLabel(n);
                  return (
                    <DropdownMenuPrimitive.RadioItem
                      key={n.namespaceId}
                      value={n.namespaceId}
                      className="flex cursor-default select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent data-[state=checked]:bg-secondary"
                    >
                      <WorkspaceTile label={label} />
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block truncate">{label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {n.memberCount} member{n.memberCount === 1 ? '' : 's'}
                        </span>
                      </span>
                      <DropdownMenuPrimitive.ItemIndicator>
                        <Check className="h-4 w-4 text-primary-ink" />
                      </DropdownMenuPrimitive.ItemIndicator>
                    </DropdownMenuPrimitive.RadioItem>
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
