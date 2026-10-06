// Namespace-admin settings surface. One section:
//
//   1. Registry owner & managers. The owner can add/remove managers;
//      managers (and non-owner admins) see the list read-only. Folder
//      roles are not here: they are core group roles + capabilities.
//
// Admin-only - the panel returns null for non-admins so the settings
// surface doesn't advertise actions the caller can't take.

import React, { useState } from 'react';
import { Crown, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useNamespacePermissions } from '@/hooks/useNamespacePermissions';
import { useRegistryAdmin } from '@/hooks/useRegistryAdmin';
import { MemberLabel, UNNAMED_MEMBER_LABEL } from '@/components/common/MemberLabel';
import { MemberPicker } from '@/components/common/MemberPicker';
import { useMemberName } from '@/hooks/useMemberName';
import { looksLikeMemberIdentity } from '@/utils/validation';

// Resolves the name the same way <MemberLabel> does, so the remove
// button's aria-label can never disagree with the visible label.
function ManagerRow({
  namespaceId,
  memberId,
  canRemove,
  busy,
  onRemove,
}: {
  namespaceId: string | null | undefined;
  memberId: string;
  canRemove: boolean;
  busy: boolean;
  onRemove: (memberId: string) => void;
}) {
  const { name, settled } = useMemberName(namespaceId, memberId);
  // Null while the name loads, so labels never call a named member unnamed.
  const label = name ?? (settled ? UNNAMED_MEMBER_LABEL : null);
  return (
    <li className="flex items-center justify-between gap-3 rounded border border-border/60 px-2 py-1">
      <MemberLabel
        namespaceId={namespaceId}
        memberId={memberId}
        className="truncate text-xs text-foreground"
      />
      {canRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          disabled={busy}
          aria-label={`Remove ${label ?? 'member'} from people who can set folder roles`}
          onClick={() => onRemove(memberId)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  );
}

export function WorkspaceSettingsPanel() {
  const {
    namespaceId,
    rootGroupId,
    registryContextId,
    registryDuplicates,
  } = useDriveWorkspace();
  // Display-name routing in this panel uses the namespace id (not the
  // registry context id) - display names are per-namespace, the same
  // scope as core's MemberMetadata.
  const perms = useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '');
  const reg = useRegistryAdmin();
  const confirm = useConfirm();

  const [managerInput, setManagerInput] = useState('');
  const [adminError, setAdminError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!perms.canManageNamespace) return null;

  const canEditManagers = reg.isOwner;

  const onAddManager = async () => {
    const m = managerInput.trim();
    if (!m) {
      setAdminError('Member ID required');
      return;
    }
    if (!looksLikeMemberIdentity(m)) {
      setAdminError("Doesn't look like a valid member ID");
      return;
    }
    if (reg.managers.includes(m)) {
      setAdminError('Already on the list');
      return;
    }
    if (reg.owner && m === reg.owner) {
      setAdminError('The owner can always set folder roles');
      return;
    }
    setAdminError(null);
    setBusy(true);
    try {
      await reg.addManager(m);
      setManagerInput('');
    } catch (e: unknown) {
      setAdminError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRemoveManager = async (m: string) => {
    const ok = await confirm({
      title: 'Stop them setting folder roles?',
      body: (
        <>
          Remove{' '}
          <MemberLabel
            namespaceId={namespaceId}
            memberId={m}
            className="font-medium"
          />
          {' '}from the people who can set folder roles? They'll keep any
          folder access they have as a workspace member.
        </>
      ),
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setAdminError(null);
    setBusy(true);
    try {
      await reg.removeManager(m);
    } catch (e: unknown) {
      setAdminError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="workspace-settings-heading"
      data-testid="workspace-settings"
      className="rounded-lg border border-border bg-card"
    >
      <header className="border-b border-border/60 px-4 py-3">
        <h3
          id="workspace-settings-heading"
          className="text-sm font-semibold text-foreground"
        >
          Admin actions
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Maintenance tasks for this workspace.
        </p>
      </header>

      {/* --- Registry owner & managers --- */}
      <div
        className="space-y-2 border-b border-border/60 px-4 py-3"
        data-testid="registry-owner-managers"
      >
        <div className="text-sm font-medium text-foreground">
          People who can set folder roles
        </div>
        <p className="text-xs text-muted-foreground">
          The workspace owner, and anyone the owner adds here, can change
          anyone's role on any folder. Only the owner can change this list.
        </p>

        {reg.error && (
          <p className="text-xs text-destructive" role="alert">
            Couldn't load roles. Try refreshing the page.
          </p>
        )}

        {/* Leftovers from the `contexts[0]` era. A namespace could accumulate
            several registry contexts, and which one the app read depended on
            list order - so one node showed the folders and another showed an
            empty workspace. The resolver now adopts the one holding the data
            and pins it, but the extra contexts still exist on the node, and an
            admin looking for "why did I see nothing yesterday" deserves to be
            told rather than left to guess. Deliberately read-only: deleting a
            context that might hold the only copy of someone's folders is not a
            thing this panel should offer. */}
        {registryDuplicates.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              This workspace has {registryDuplicates.length + 1} duplicate
              copies of its folder data.
            </p>
            <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-400/90">
              Older versions of this app picked one by list order, which two
              nodes do not agree on. That is why folders could appear to
              vanish. The one holding your folders is now pinned for everyone:
            </p>
            <p className="mt-1 font-mono text-[11px] text-foreground">
              {registryContextId?.slice(0, 16)}…
            </p>
            <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-400/90">
              The others are left in place rather than deleted. They may hold
              folders created before the pin:
            </p>
            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {registryDuplicates.map((id) => (
                <li key={id}>{id.slice(0, 16)}…</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm">
          <Crown className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          <span className="text-muted-foreground">Owner:</span>
          {reg.owner && (
            <MemberLabel
              namespaceId={namespaceId}
              memberId={reg.owner}
              className="text-xs text-foreground"
            />
          )}
          {reg.isOwner && (
            <span className="rounded-full bg-selected px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-selected-foreground">
              You
            </span>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Added by the owner
          </div>
          {reg.managers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nobody added yet. Only the owner can set folder roles.
            </p>
          ) : (
            <ul className="space-y-1">
              {reg.managers.map((m) => (
                <ManagerRow
                  key={m}
                  namespaceId={namespaceId}
                  memberId={m}
                  canRemove={canEditManagers}
                  busy={busy}
                  onRemove={(memberId) => {
                    void onRemoveManager(memberId);
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        {canEditManagers ? (
          <div className="space-y-2 pt-1">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                {/* MemberPicker autocompletes against the namespace's
                    existing members; excludes the current owner and
                    anyone already a manager so they can't be re-added.
                    Free-form Enter still commits a raw pubkey paste -
                    the existing looksLikeMemberIdentity check in
                    onAddManager runs unchanged. */}
                <MemberPicker
                  namespaceId={namespaceId}
                  exclude={[reg.owner, ...reg.managers].filter(
                    (s): s is string => !!s,
                  )}
                  placeholder="Search members or paste a member ID…"
                  ariaLabel="member to add"
                  disabled={busy}
                  onSelect={(identity) => {
                    setManagerInput(identity);
                    setAdminError(null);
                  }}
                />
                {managerInput && (
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    Selected:{' '}
                    <MemberLabel
                      namespaceId={namespaceId}
                      memberId={managerInput}
                      className="text-foreground"
                    />
                  </p>
                )}
              </div>
              <Button
                size="sm"
                className="gap-1"
                disabled={busy || !managerInput.trim()}
                onClick={() => {
                  void onAddManager();
                }}
              >
                <UserPlus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          </div>
        ) : (
          <p className="pt-1 text-xs text-muted-foreground">
            Only the workspace owner can change this list.
          </p>
        )}

        {adminError && (
          <p className="text-xs text-destructive" role="alert">
            {adminError}
          </p>
        )}
      </div>

    </section>
  );
}
