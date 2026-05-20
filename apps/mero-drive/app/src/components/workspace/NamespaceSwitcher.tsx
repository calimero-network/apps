// Top-bar namespace picker. Renders the list of namespaces for this
// application (from useDriveWorkspace — which reads
// `useNamespacesForApplication` internally) and lets the user switch
// the active workspace.
//
// namespaceId doubles as the root groupId under the current admin
// API (it's the parent groupId for createGroupInNamespace,
// useSubgroups, etc.) — useDriveWorkspace exposes both fields but
// derives `rootGroupId` from `selectedNamespaceId` directly.

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
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
  const [showJoin, setShowJoin] = useState(false);

  if (loading && namespaces.length === 0) {
    return (
      <div className="px-3 py-1.5 text-sm text-muted-foreground">Loading workspaces…</div>
    );
  }

  if (error && namespaces.length === 0) {
    return (
      <div className="px-3 py-1.5 text-sm text-destructive" title={error.message}>
        Failed to load workspaces
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className="h-9 px-2 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={selectedNamespaceId ?? ''}
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return;
          selectNamespace(id);
        }}
      >
        <option value="" disabled>
          Pick a workspace
        </option>
        {namespaces.map((n) => (
          <option key={n.namespaceId} value={n.namespaceId}>
            {n.name ?? n.namespaceId.slice(0, 8)}
          </option>
        ))}
      </select>
      <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
        New workspace
      </Button>
      <Button variant="outline" size="sm" onClick={() => setShowJoin(true)}>
        Join workspace
      </Button>
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
    </div>
  );
}
