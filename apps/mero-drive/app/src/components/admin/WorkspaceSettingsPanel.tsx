// Namespace-admin settings surface. Two sections:
//
//   1. Registry owner & managers — the fail-closed authorization roots
//      for the per-folder Role API (set_folder_role / add_manager all
//      require owner-or-manager). The owner can add/remove managers;
//      managers (and non-owner admins) see the list read-only. If the
//      registry is unclaimed (a namespace seeded before `claim_owner`
//      was wired in), any namespace-admin can "Claim ownership".
//
//   2. Reconcile registry — an idempotent diff+apply that brings the
//      folder registry in line with admin-side groups. Safe to run at
//      any time; acts only on drifted entries.
//
// Both are admin-only — the panel returns null for non-admins so the
// settings surface doesn't advertise actions the caller can't take.
//
// TODO: extend Reconcile's summary to also report registry-permission
// drift (owner/managers vs core namespace-admins out of sync) + an
// "Add core admins as managers" action. Today it only reports folder
// register/unregister/move drift. (Per the plan: shipped Step 1 only;
// the reconcile-permission-drift extension is a follow-up.)

import React, { useState } from 'react';
import { RefreshCw, Crown, ShieldCheck, UserPlus } from 'lucide-react';
import { useSubgroups } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useNamespacePermissions } from '@/hooks/useNamespacePermissions';
import { useRegistryAdmin } from '@/hooks/useRegistryAdmin';
import { useReconcile } from '@/hooks/useReconcile';
import { MemberLabel } from '@/components/common/MemberLabel';
import { MemberPicker } from '@/components/common/MemberPicker';
import { looksLikeMemberIdentity } from '@/utils/validation';

export function WorkspaceSettingsPanel() {
  const { namespaceId, rootGroupId, registryClient } = useDriveWorkspace();
  // Display-name routing in this panel uses the namespace id (not the
  // registry context id) — display names are per-namespace, the same
  // scope as core's MemberMetadata.
  const perms = useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '');
  const { subgroups } = useSubgroups(rootGroupId);
  const { run, running, last, error } = useReconcile(
    rootGroupId,
    registryClient,
    subgroups,
  );
  const reg = useRegistryAdmin();
  const confirm = useConfirm();

  const [managerInput, setManagerInput] = useState('');
  const [adminError, setAdminError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!perms.canManageNamespace) return null;

  const unclaimed = reg.owner === null;
  const canEditManagers = reg.isOwner;

  const onClaim = async () => {
    setAdminError(null);
    setBusy(true);
    try {
      await reg.claimOwner();
    } catch (e: unknown) {
      setAdminError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onAddManager = async () => {
    const m = managerInput.trim();
    if (!m) {
      setAdminError('Identity required');
      return;
    }
    if (!looksLikeMemberIdentity(m)) {
      setAdminError("Identity doesn't look like a valid pubkey");
      return;
    }
    if (reg.managers.includes(m)) {
      setAdminError('Already a manager');
      return;
    }
    if (reg.owner && m === reg.owner) {
      setAdminError('The owner is implicitly a manager');
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
      title: 'Remove manager?',
      body: (
        <>
          Remove{' '}
          <MemberLabel
            namespaceId={namespaceId}
            memberId={m}
            className="font-medium"
          />
          {' '}from the registry managers? They'll keep any folder access they
          have through namespace membership, but lose the ability to change
          folder roles.
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
          Registry owner &amp; managers
        </div>
        <p className="text-xs text-muted-foreground">
          The owner (and managers they appoint) can change per-folder
          roles. Only the owner can change the manager list.
        </p>

        {reg.error && (
          <p className="text-xs text-destructive" role="alert">
            Couldn't load registry roles: {reg.error.message}
          </p>
        )}

        {unclaimed ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2">
            <span className="text-xs text-muted-foreground">
              This workspace's registry has no owner yet.
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || reg.loading || !registryClient}
              onClick={() => {
                void onClaim();
              }}
            >
              {busy ? 'Claiming…' : 'Claim ownership'}
            </Button>
          </div>
        ) : (
          <>
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
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                  You
                </span>
              )}
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                Managers
              </div>
              {reg.managers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No managers — only the owner can change folder roles.
                </p>
              ) : (
                <ul className="space-y-1">
                  {reg.managers.map((m) => (
                    <li
                      key={m}
                      className="flex items-center justify-between gap-3 rounded border border-border/60 px-2 py-1"
                    >
                      <MemberLabel
                        namespaceId={namespaceId}
                        memberId={m}
                        className="truncate text-xs text-foreground"
                      />
                      {canEditManagers && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          disabled={busy}
                          aria-label={`Remove manager ${m.slice(0, 8)}`}
                          onClick={() => {
                            void onRemoveManager(m);
                          }}
                        >
                          <span aria-hidden>×</span>
                        </Button>
                      )}
                    </li>
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
                        Free-form Enter still commits a raw pubkey paste —
                        the existing looksLikeMemberIdentity check in
                        onAddManager runs unchanged. */}
                    <MemberPicker
                      namespaceId={namespaceId}
                      exclude={[reg.owner, ...reg.managers].filter(
                        (s): s is string => !!s,
                      )}
                      placeholder="Search members or paste a pubkey…"
                      ariaLabel="manager identity"
                      disabled={busy}
                      onSelect={(identity) => {
                        setManagerInput(identity);
                        setAdminError(null);
                      }}
                    />
                    {managerInput && (
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        Selected:{' '}
                        <code className="text-foreground">
                          {managerInput.slice(0, 16)}…
                        </code>
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
                    Add manager
                  </Button>
                </div>
              </div>
            ) : (
              <p className="pt-1 text-xs text-muted-foreground">
                Only the workspace owner can change managers.
              </p>
            )}
          </>
        )}

        {adminError && (
          <p className="text-xs text-destructive" role="alert">
            {adminError}
          </p>
        )}
      </div>

      {/* --- Reconcile registry --- */}
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            Reconcile registry
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Bring the folder registry in line with admin-side groups.
            Safe to run any time; acts only on drifted entries.
          </p>
          {last && (
            <p
              className="mt-1 text-xs text-muted-foreground"
              data-testid="reconcile-result"
            >
              Last run: registered {last.registered}, unregistered{' '}
              {last.unregistered}, moved {last.moved}
            </p>
          )}
          {error && (
            <p className="mt-1 text-xs text-destructive" role="alert">
              Reconcile failed: {error.message}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          disabled={running}
          onClick={() => {
            void run();
          }}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`}
          />
          {running ? 'Running…' : 'Reconcile'}
        </Button>
      </div>
    </section>
  );
}
