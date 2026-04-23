// Members list + invite/remove for a single folder. Permission-gated
// by useFolderPermissions:
//   - canInviteMembers  → show the invite form
//   - canManageMembers  → show the remove button per member
// Read-only viewers (neither cap) still see the members list, so
// they know who's in the folder — just can't modify it. If you
// want to hide the whole panel for read-only viewers, the caller
// should conditionally render.
//
// useFolderMembership's add() takes (identity, role). Per the
// Phase 7 README-ish notes in useFolderMembership, capability
// bitmasks flow through a separate useGroupCapabilities call; this
// panel currently adds with the default role "member" and leaves
// cap-editing for Phase 8-E's MemberRoleSelect.

import React, { useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useFolderMembership } from '@/hooks/useFolderMembership';

interface Props {
  folderId: string;
}

// Rough sanity-check on the pubkey format — Calimero identities
// are base58-encoded Ed25519 pubkeys, in the 40–50 char range.
// "Don't send obviously-garbage input" guard, not a cryptographic
// check; the node validates the actual format.
//
// The character class below IS the canonical Bitcoin base58
// alphabet: `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`
// — no `0 O I l`. Decoded range-by-range:
//   1-9    → digits (no 0)
//   A-H    → no I (65..72; I is 73)
//   J-N    → no I before, no O after (74..78; O is 79)
//   P-Z    → no O
//   a-k    → no l (97..107; l is 108)
//   m-n    → skips l
//   p-z    → skips o (o is 111)
const IDENTITY_LOOKS_VALID = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;

export function FolderSharingPanel({ folderId }: Props) {
  const { namespaceId } = useWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const { members, loading, error, add, remove, refetch } =
    useFolderMembership(folderId);
  const confirm = useConfirm();

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
    IDENTITY_LOOKS_VALID.test(trimmedIdentity) &&
    !members.some((m) => m.identity === trimmedIdentity) &&
    !inviting;

  const onInvite = async () => {
    if (!trimmedIdentity) {
      setInviteError('Identity required');
      return;
    }
    if (!IDENTITY_LOOKS_VALID.test(trimmedIdentity)) {
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
      body: <>Remove <code className="text-xs">{label}</code> from this folder?</>,
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
      // member list — remove() may have partially applied.
      await refetch();
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
          const label = m.alias ?? `${m.identity.slice(0, 8)}…`;
          const rowErr =
            removeError?.identity === m.identity ? removeError.message : null;
          return (
            <li
              key={m.identity}
              className="px-4 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">
                    {label}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.role}
                  </div>
                </div>
                {perms.canManageMembers && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={removingId === m.identity}
                    aria-label={`Remove ${label}`}
                    onClick={() => onRemove(m.identity, label)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
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

      {perms.canInviteMembers && (
        <div className="border-t border-border/60 px-4 py-3">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Invite by identity
          </label>
          <div className="flex gap-2">
            <input
              className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="identity pubkey"
              value={identity}
              onChange={(e) => {
                setIdentity(e.target.value);
                setInviteError(null);
              }}
              disabled={inviting}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canInvite) onInvite();
              }}
            />
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
      )}
    </section>
  );
}
