// Full settings view — composes the members panel and admin
// actions panel into a single surface. Rendered by
// WorkspaceLayout when the settings toggle is active.
//
// Both child panels handle their own permission-gating and
// loading states, so this composition is intentionally thin.

import React from 'react';
import { useNamespacesForApplication } from '@calimero-network/mero-react';
import { getApplicationId } from '@/constants/config';
import { useWorkspace } from '@/context/WorkspaceContext';
import { NamespaceMembersPanel } from './NamespaceMembersPanel';
import { WorkspaceSettingsPanel } from '@/components/admin/WorkspaceSettingsPanel';

export function NamespaceSettingsPanel() {
  const { namespaceId } = useWorkspace();
  const { namespaces } = useNamespacesForApplication(getApplicationId());
  const ns = namespaces.find((n) => n.namespaceId === namespaceId);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Workspace settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ns?.alias ?? namespaceId?.slice(0, 12) ?? 'Unknown workspace'}
          {ns && (
            <>
              {' '}
              · {ns.memberCount} member{ns.memberCount === 1 ? '' : 's'}
              {' '}
              · {ns.contextCount} context{ns.contextCount === 1 ? '' : 's'}
            </>
          )}
        </p>
      </div>

      <NamespaceMembersPanel />
      <WorkspaceSettingsPanel />
    </div>
  );
}
