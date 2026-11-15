// Full settings view - composes the members panel and admin
// actions panel into a single surface. Rendered by
// WorkspaceLayout when the settings toggle is active.
//
// Both child panels handle their own permission-gating and
// loading states, so this composition is intentionally thin.

import React from 'react';
import { ManageInHomeLink } from '@calimero-apps/passkey';
import { useMero } from '@/calimero/react';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { namespaceLabel } from '@/lib/namespaceLabel';
import { peopleCount } from '@/lib/roles';
import { NamespaceMembersPanel } from './NamespaceMembersPanel';
import { MemberDefaultsPanel } from '@/components/admin/MemberDefaultsPanel';
import { MyDisplayNamePanel } from '@/components/admin/MyDisplayNamePanel';
import { WorkspaceSettingsPanel } from '@/components/admin/WorkspaceSettingsPanel';
import { WorkspaceExitPanel } from './WorkspaceExitPanel';
import { WorkspaceTrustPanel } from './WorkspaceTrustPanel';

export function NamespaceSettingsPanel() {
  const { namespaceId, namespaces, namespaceMembers } = useDriveWorkspace();
  const { session } = useMero();
  const ns = namespaces.find((n) => n.namespaceId === namespaceId);
  const count = ns
    ? peopleCount(ns.memberCount ?? 0, namespaceMembers.teeMembers.length)
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

      <div className="flex items-center justify-between sm:hidden">
        <span className="text-sm font-medium text-foreground">Theme</span>
        <ThemeToggle />
      </div>
      <ManageInHomeLink
        session={session}
        org={namespaceId}
        className="text-sm font-medium text-primary no-underline hover:underline min-[1440px]:hidden"
      />
      <MyDisplayNamePanel />
      <MemberDefaultsPanel />
      <NamespaceMembersPanel />
      <WorkspaceSettingsPanel />
      <WorkspaceTrustPanel />
      <WorkspaceExitPanel />
    </div>
  );
}
