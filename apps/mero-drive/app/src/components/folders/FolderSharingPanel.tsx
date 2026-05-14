// Members + sharing controls for a single folder. Two layouts,
// branched on the folder's subgroup visibility (core PR #2261):
//
//   Restricted — explicit membership: add-by-identity / invite-link /
//     remove, plus (for owner/managers) a per-member folder-role
//     dropdown (FolderRoleSelect — Viewer / Editor / Manager).
//
//   Open — inherits membership from the workspace root: there's no
//     add/remove (anyone in the workspace is already in), so we show
//     "open to all workspace members" copy instead, but STILL list the
//     inherited members each with the folder-role dropdown so an admin
//     can pin someone to Viewer (downgrade their doc access) or
//     Manager (promote them) on this folder.
//
// Permission-gating (useFolderPermissions):
//   - canInviteMembers      → show the invite form (Restricted only)
//   - canManageMembers      → show the per-member remove button
//   - canManagePermissions  → show the folder-role dropdowns (the
//                             registry owner / managers, or a core
//                             group-admin)
// Read-only viewers still see the members list.
//
// TODO: "Advanced" per-row expander (individual core-cap checkboxes +
// the Role radio) — a follow-up; today only the preset dropdown ships.

import React, { useMemo, useState } from 'react';
import { UserPlus, Link2, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useFolderMembership } from '@/hooks/useFolderMembership';
import { useFolderRoles } from '@/hooks/useFolderRole';
import { useCreateFolderInvite } from '@/hooks/useNamespaceInvitation';
import { InviteDialog } from '@/components/workspace/InviteDialog';
import { FolderMemberRoleRow } from '@/components/admin/FolderMemberRoleRow';
import { MemberLabel } from '@/components/common/MemberLabel';
import { MemberPicker } from '@/components/common/MemberPicker';
import type { Role } from '@/api/registry/RegistryClient';
import { looksLikeMemberIdentity } from '@/utils/validation';

interface Props {
  folderId: string;
}

// Identity-format guard lives in utils/validation; see notes there
// (base58 alphabet, length window, client-only UX check).

export function FolderSharingPanel({ folderId }: Props) {
  const { namespaceId, folders, selfIdentity } = useDriveWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const { members, loading, error, add, remove, refetch } =
    useFolderMembership(folderId);
  const { entries: roleEntries, refetch: refetchRoles } =
    useFolderRoles(folderId);
  const { create: createFolderInvite } = useCreateFolderInvite();
  const confirm = useConfirm();
  const [inviteLinkOpen, setInviteLinkOpen] = useState(false);

  const folder = folders.find((f) => f.id === folderId);
  const folderAlias = folder?.alias ?? `${folderId.slice(0, 8)}…`;
  // Only an explicit 'Open' visibility takes the open layout; anything
  // else (Restricted, or not-yet-resolved) keeps the explicit-members
  // layout, which is the safe default.
  const isOpenFolder = folder?.visibility === 'Open';

  // member identity → registry Role (default 'Editor' when absent).
  const roleByMember = useMemo(() => {
    const m = new Map<string, Role>();
    for (const e of roleEntries) m.set(e.member, e.role);
    return m;
  }, [roleEntries]);

  const [identity, setIdentity] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Per-row remove error — surfaced inline under the affected row
  // so the user sees which identity's removal failed and why,
  // rather than the error being swallowed to the console.
  const [removeError, setRemoveError] = useState<
    { identity: string; message: string } | null
  >(null);

  const trimmedIdentity = identity.trim();
  const canInvite =
    perms.canInviteMembers &&
    !!trimmedIdentity &&
    looksLikeMemberIdentity(trimmedIdentity) &&
    !members.some((m) => m.identity === trimmedIdentity) &&
    !inviting;

  const onInvite = async () => {
    if (!trimmedIdentity) {
      setInviteError('Identity required');
      return;
    }
    if (!looksLikeMemberIdentity(trimmedIdentity)) {
      setInviteError('Identity doesn’t look like a valid pubkey');
      return;
    }
    if (members.some((m) => m.identity === trimmedIdentity)) {
      setInviteError('Already a member');
      return;
    }
    setInviting(true);
    setInviteError(null);
    try {
      await add(trimmedIdentity);
      setIdentity('');
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setInviteError(err.message);
    } finally {
      setInviting(false);
    }
  };

  const onRemove = async (id: string, label: string) => {
    const ok = await confirm({
      title: 'Remove member?',
      body: (
        <>
          Remove{' '}
          <MemberLabel
            namespaceId={namespaceId}
            memberId={id}
            fallback={() => label}
            className="font-medium"
          />
          {' '}from this folder?
        </>
      ),
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setRemovingId(id);
    setRemoveError(null);
    try {
      await remove(id);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setRemoveError({ identity: id, message: err.message });
      // Refetch so the UI stays consistent with the node's actual
      // member list — remove() may have partially applied. Wrapped
      // in its own try/catch because the outer call is
      // fire-and-forget from the button's onClick; if refetch()
      // also fails (likely the same network issue that failed
      // remove), an uncaught throw would surface as an unhandled
      // promise rejection.
      try {
        await refetch();
      } catch (refetchErr) {
        console.warn(
          'refetch after remove failure also failed',
          refetchErr,
        );
      }
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section
      aria-labelledby="sharing-heading"
      className="rounded-lg border border-border bg-card"
    >
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-2">
        <h3
          id="sharing-heading"
          className="text-sm font-semibold text-foreground"
        >
          Members
        </h3>
        {loading && (
          <span className="text-xs text-muted-foreground">Loading…</span>
        )}
      </header>

      {isOpenFolder && (
        <p className="flex items-start gap-2 border-b border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
          <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Open to all workspace members — anyone in the workspace can join
            and edit this folder. Use the role dropdowns below to pin a
            specific person to <strong>Viewer</strong> (read-only) or{' '}
            <strong>Manager</strong>.
          </span>
        </p>
      )}

      {error && (
        <p
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          Failed to load members: {error.message}
        </p>
      )}

      <ul className="divide-y divide-border/40">
        {members.length === 0 && !loading && (
          <li className="px-4 py-3 text-xs text-muted-foreground">
            No members yet.
          </li>
        )}
        {members.map((m) => {
          const label = m.name ?? `${m.identity.slice(0, 8)}…`;
          const rowErr =
            removeError?.identity === m.identity ? removeError.message : null;
          const isSelfRow = !!selfIdentity && m.identity === selfIdentity;
          if (perms.canManagePermissions) {
            return (
              <React.Fragment key={m.identity}>
                <FolderMemberRoleRow
                  folderId={folderId}
                  identity={m.identity}
                  label={label}
                  coreRole={m.role}
                  registryRole={roleByMember.get(m.identity) ?? 'Editor'}
                  isSelf={isSelfRow}
                  canManage
                  onAfterRoleChange={refetchRoles}
                  // No per-member remove on Open folders — membership is
                  // inherited; removing here wouldn't stick.
                  onRemove={
                    !isOpenFolder && perms.canManageMembers
                      ? onRemove
                      : undefined
                  }
                  removing={removingId === m.identity}
                />
                {rowErr && (
                  <li className="px-4 pb-1 text-xs text-destructive" role="alert">
                    Remove failed: {rowErr}
                  </li>
                )}
              </React.Fragment>
            );
          }
          // Read-only view (no canManagePermissions): name + the
          // member's core role label, optional remove if they can
          // manage members on a Restricted folder.
          return (
            <li key={m.identity} className="px-4 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">
                    <MemberLabel
                      namespaceId={namespaceId}
                      memberId={m.identity}
                      isSelf={isSelfRow}
                      fallback={() => label}
                    />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.role}
                  </div>
                </div>
                {!isOpenFolder && perms.canManageMembers && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={removingId === m.identity}
                    aria-label={`Remove ${label}`}
                    onClick={() => onRemove(m.identity, label)}
                  >
                    <span aria-hidden>×</span>
                  </Button>
                )}
              </div>
              {rowErr && (
                <p className="mt-1 text-xs text-destructive" role="alert">
                  Remove failed: {rowErr}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {!isOpenFolder && perms.canInviteMembers && (
        <div className="space-y-3 border-t border-border/60 px-4 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Invite by identity
            </label>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                {/* Autocompletes against workspace members; existing
                    folder members are filtered out. Raw-paste of an
                    unknown pubkey still works via Enter — looksLike-
                    MemberIdentity validation runs unchanged in
                    onInvite below. */}
                <MemberPicker
                  namespaceId={namespaceId}
                  exclude={members.map((m) => m.identity)}
                  placeholder="identity pubkey"
                  ariaLabel="identity pubkey"
                  disabled={inviting}
                  onSelect={(id) => {
                    setIdentity(id);
                    setInviteError(null);
                  }}
                />
                {identity && (
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    Selected:{' '}
                    <code className="text-foreground">
                      {identity.slice(0, 16)}…
                    </code>
                  </p>
                )}
              </div>
              <Button
                size="sm"
                onClick={onInvite}
                disabled={!canInvite}
                className="gap-1"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {inviting ? 'Adding…' : 'Add'}
              </Button>
            </div>
            {inviteError && (
              <p className="mt-2 text-xs text-destructive">{inviteError}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Or share a link
            </label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setInviteLinkOpen(true)}
              className="gap-1"
            >
              <Link2 className="h-3.5 w-3.5" />
              Invite to this folder only
            </Button>
          </div>
        </div>
      )}

      {inviteLinkOpen && (
        <InviteDialog
          title="Invite to folder"
          description={
            <>
              Share this link to add someone to{' '}
              <span className="font-medium text-foreground">{folderAlias}</span>
              {' '}only — they won't gain access to other folders or the
              workspace root.
            </>
          }
          footnote="Scope: this folder only. Anyone with this link and a Calimero identity can join."
          onCreate={() => createFolderInvite(folderId)}
          onClose={() => setInviteLinkOpen(false)}
        />
      )}
    </section>
  );
}
