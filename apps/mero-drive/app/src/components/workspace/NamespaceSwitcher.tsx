// Top-bar namespace picker. Renders the list of namespaces for
// this application and lets the user select the active workspace.
// Selection flows into WorkspaceContext, which every downstream
// hook subscribes to.
//
// Namespace and root-group are the same id under the current admin
// API (namespaceId is used as the parent groupId for
// createGroupInNamespace, reparent_group, useSubgroups, etc.), so
// we pass namespaceId for both slots of setNamespace.

import React, { useState } from 'react';
import { useNamespacesForApplication } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { getApplicationId } from '@/constants/config';
import { useWorkspace } from '@/context/WorkspaceContext';
import { NamespaceCreateDialog } from './NamespaceCreateDialog';

export function NamespaceSwitcher() {
  const appId = getApplicationId();
  const { namespaces, loading, error, refetch } = useNamespacesForApplication(appId);
  const { namespaceId, setNamespace } = useWorkspace();
  const [showCreate, setShowCreate] = useState(false);

  if (loading) {
    return (
      <div className="px-3 py-1.5 text-sm text-muted-foreground">Loading workspaces…</div>
    );
  }

  if (error) {
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
        value={namespaceId ?? ''}
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return;
          // namespaceId doubles as the root groupId for admin-API
          // calls — see file header.
          setNamespace(id, id);
        }}
      >
        <option value="" disabled>
          Pick a workspace
        </option>
        {namespaces.map((n) => (
          <option key={n.namespaceId} value={n.namespaceId}>
            {n.alias ?? n.namespaceId.slice(0, 8)}
          </option>
        ))}
      </select>
      <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
        New workspace
      </Button>
      {showCreate && (
        <NamespaceCreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            await refetch();
          }}
        />
      )}
    </div>
  );
}
