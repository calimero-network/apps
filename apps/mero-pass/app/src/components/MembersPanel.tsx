import { useCallback, useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@calimero-network/mero-ui';

import {
  canCreateVault,
  canInvite,
  canManageMembers,
  missingForRole,
  roleLabel,
  satisfiesRole,
  type SpaceRole,
} from '../lib/roles';
import {
  listSpaceMembers,
  setMemberRole,
  type SpaceMember,
} from '../lib/vaults';

/**
 * Who is in a space, what they may do, and the controls to change it.
 *
 * ── The two things this panel refuses to conflate ────────────────────────────
 *
 * A row shows the ROLE the node has recorded and, separately, whether the
 * CAPABILITIES behind it actually landed. They are set by different calls and
 * can disagree; when they do, the row says so rather than rendering "Admin"
 * over a person every admin endpoint refuses. That disagreement is not
 * hypothetical — writing the role and forgetting the mask is the normal way to
 * get it, and it looks completely correct from the UI side.
 *
 * ── Why a promotion can read as incomplete for a moment ──────────────────────
 *
 * A grant is an op: it is published, then PROJECTED by each node that receives
 * it, and it confers nothing in between. The promoted person is on another
 * node, so their own client sees the new capabilities only once the op has
 * reached and been projected by it. "Not applied yet" is therefore a real and
 * temporary state, and it is reported as the list of bits still missing rather
 * than as a failure.
 */
export default function MembersPanel({
  namespaceId,
  spaceName,
  myAccountId,
  myCapabilities,
  onRolesChanged,
}: {
  namespaceId: string;
  spaceName: string;
  myAccountId: string | null;
  /** This node's own mask — what gates the controls below. */
  myCapabilities: number | null;
  /** Re-read the caller's own capabilities: demoting yourself is allowed. */
  onRolesChanged: () => void;
}) {
  const { mero } = useMero();
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const iMayManage = canManageMembers(myCapabilities);

  const load = useCallback(async () => {
    if (!mero) return;
    setLoading(true);
    try {
      setMembers(await listSpaceMembers(mero.admin, namespaceId, myAccountId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mero, namespaceId, myAccountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = useCallback(
    async (member: SpaceMember, role: SpaceRole) => {
      if (!mero) return;
      setError(null);
      setNotice(null);
      setConfirming(null);
      try {
        const result = await setMemberRole(
          mero.admin,
          { namespaceId, accountId: member.accountId, role },
          (m) => setBusy(m),
        );
        if (result.effective) {
          setNotice(
            `${member.name} is now ${roleLabel(role)} — the node confirms the capabilities that go with it.`,
          );
        } else {
          // Named, not hidden behind "something went wrong". These are the bits
          // the promotion is short of, and the usual reason is that the op has
          // not projected yet.
          setNotice(
            `${member.name}'s role is now ${roleLabel(role)}, but the node has not applied ${result.missing.join(', ')} yet. Re-check in a moment; if it persists, the change did not take.`,
          );
        }
        await load();
        onRolesChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [mero, namespaceId, load, onRolesChanged],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>People in {spaceName}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            An Admin can create vaults, invite people and change roles. A Member
            can open every vault in the space and read and write its secrets —
            which is what they were invited for.
          </p>

          {error && <Alert description={error} />}
          {notice && <Alert description={notice} />}
          {busy && <p className="text-sm text-gray-500">{busy}</p>}

          {!iMayManage && (
            <p className="text-sm text-gray-500">
              You are a Member of this space, so the roles below are read-only.
              Ask an Admin to change them.
            </p>
          )}

          {loading ? (
            <p className="text-sm text-gray-500">Loading people…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nobody else is in this space yet. Use Invite to add someone.
            </p>
          ) : (
            <div className="space-y-3">
              {members.map((member) => {
                const short = `${member.accountId.slice(0, 8)}…`;
                const mismatched = !satisfiesRole(
                  member.capabilities,
                  member.role,
                );
                const target: SpaceRole =
                  member.role === 'admin' ? 'member' : 'admin';
                return (
                  <div
                    key={member.accountId}
                    className="flex items-center justify-between border rounded-lg p-3 gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {member.name}
                          {member.isSelf ? ' (you)' : ''}
                        </span>
                        <Badge
                          variant={member.role === 'admin' ? 'info' : 'outline'}
                        >
                          {roleLabel(member.role)}
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-600 font-mono">
                        {short}
                      </div>
                      {mismatched && (
                        <div className="text-xs text-gray-500">
                          {/* The whole reason capabilities are read per row. */}
                          Recorded as {roleLabel(member.role)}, but the node has
                          not applied{' '}
                          {missingForRole(
                            member.capabilities,
                            member.role,
                          ).join(', ')}
                          . They cannot use it until it does.
                        </div>
                      )}
                      <div className="text-xs text-gray-600">
                        {canCreateVault(member.capabilities)
                          ? 'Can create vaults'
                          : 'Cannot create vaults'}
                        {' · '}
                        {canInvite(member.capabilities)
                          ? 'can invite'
                          : 'cannot invite'}
                        {' · '}
                        {canManageMembers(member.capabilities)
                          ? 'can change roles'
                          : 'cannot change roles'}
                      </div>
                    </div>

                    {iMayManage && (
                      <div className="space-y-2">
                        {confirming === member.accountId ? (
                          <div className="space-y-2">
                            {/* ⚠️ The honest sentence. Demotion is not
                                revocation and must not be sold as one. */}
                            <div className="text-xs text-gray-500 max-w-2xl">
                              {target === 'member'
                                ? `Demoting ${member.name} stops them creating vaults, inviting people and changing roles. It does NOT remove them from the space, and they keep read and write access to every vault here. It cannot un-sync secrets their node has already copied — to protect those, rotate them.`
                                : `Promoting ${member.name} lets them create vaults, invite anyone into this space and change roles, including yours.`}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant={
                                  target === 'member' ? 'error' : 'primary'
                                }
                                onClick={() => void change(member, target)}
                                disabled={!!busy}
                              >
                                {target === 'member'
                                  ? 'Demote to Member'
                                  : 'Promote to Admin'}
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => setConfirming(null)}
                                disabled={!!busy}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() => setConfirming(member.accountId)}
                            disabled={!!busy}
                          >
                            {member.role === 'admin'
                              ? 'Demote'
                              : 'Promote to Admin'}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <Button variant="secondary" onClick={() => void load()}>
            Refresh people
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
