// Full settings view - composes the members panel and admin
// actions panel into a single surface. Rendered by
// WorkspaceLayout when the settings toggle is active.
//
// Both child panels handle their own permission-gating and
// loading states, so this composition is intentionally thin.

import React from 'react';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { namespaceLabel } from '@/lib/namespaceLabel';
import { peopleCount } from '@/lib/roles';
import { NamespaceMembersPanel } from './NamespaceMembersPanel';
import { MemberDefaultsPanel } from '@/components/admin/MemberDefaultsPanel';
import { MyDisplayNamePanel } from '@/components/admin/MyDisplayNamePanel';
import { WorkspaceSettingsPanel } from '@/components/admin/WorkspaceSettingsPanel';

export function NamespaceSettingsPanel() {
  const { namespaceId, namespaces, namespaceMembers } = useDriveWorkspace();
  const ns = namespaces.find((n) => n.namespaceId === namespaceId);
  // Core's `memberCount` counts TEE nodes too; the members list below does not.
  const count = ns
    ? peopleCount(ns.memberCount, namespaceMembers.teeMembers.length)
    : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Workspace settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {namespaceId ? namespaceLabel(ns?.name) : 'Unknown workspace'}
          {ns && (
            <>
              {' '}
              · {count} member{count === 1 ? '' : 's'}
            </>
          )}
        </p>
      </div>

      <MyDisplayNamePanel />
      <MemberDefaultsPanel />
      <NamespaceMembersPanel />
      <WorkspaceSettingsPanel />
    </div>
  );
}
