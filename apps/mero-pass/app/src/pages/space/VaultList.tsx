import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from '@calimero-network/mero-ui';

import InviteModal from '../../components/InviteModal';
import MembersPanel from '../../components/MembersPanel';
import { useApplicationId } from '../../hooks/useApplicationId';
import { useSpaceCapabilities } from '../../hooks/useSpaceCapabilities';
import { canCreateVault, canInvite } from '../../lib/roles';
import {
  createVault,
  displayName,
  enterVaultContext,
  listSpaces,
  listVaults,
  mintSpaceInvite,
  mintVaultInvite,
  type VaultRow,
} from '../../lib/vaults';

/**
 * The vaults inside one space.
 *
 * A vault is a subgroup plus its own context, so two things are true and both
 * are visible here: a member of the space can SEE every vault in it (the
 * subgroup listing and its metadata name are namespace-scoped), but has to
 * ENTER one before any secret is readable — entering is what gets this node an
 * identity in the vault's context.
 *
 * That is why a row can read "Open" for one person and "Join" for another, and
 * why the join is an explicit action rather than something the list does for
 * you: auto-follow only carries contexts created AFTER you joined the space, so
 * for every vault that already existed there is a real join to make.
 */
export default function VaultList() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const { mero } = useMero();
  const navigate = useNavigate();
  const { appId, notInstalled } = useApplicationId();
  // What THIS node may actually do here, as the node enforces it — not a role
  // string, and not an assumption that whoever opened the page is an admin.
  // Every control below is gated on it, so the UI cannot offer an action that
  // comes back 403.
  const {
    accountId,
    capabilities,
    loading: capabilitiesLoading,
    refetch: refetchCapabilities,
  } = useSpaceCapabilities(spaceId ?? null);
  const mayCreateVault = canCreateVault(capabilities);
  const mayInvite = canInvite(capabilities);

  const [spaceName, setSpaceName] = useState('');
  const [vaults, setVaults] = useState<VaultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    code: string;
    scope: string;
    hint: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!mero || !spaceId) return;
    setLoading(true);
    try {
      setVaults(await listVaults(mero.admin, spaceId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mero, spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The space's own name, for the heading and for the invitation scope. Read
  // from the namespace listing rather than carried in the route, so a link
  // opened cold shows the name too.
  useEffect(() => {
    if (!mero || !appId || !spaceId) return;
    let cancelled = false;
    listSpaces(mero.admin, appId)
      .then((rows) => {
        if (cancelled) return;
        const mine = rows.find((r) => r.namespaceId === spaceId);
        setSpaceName(mine?.name ?? '');
      })
      .catch(() => {
        if (!cancelled) setSpaceName('');
      });
    return () => {
      cancelled = true;
    };
  }, [mero, appId, spaceId]);

  const heading = spaceId
    ? displayName([spaceName], spaceId, 'Space')
    : 'Space';

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!mero || !appId || !spaceId || !name) return;
    setError(null);
    try {
      await createVault(
        mero.admin,
        { applicationId: appId, namespaceId: spaceId, name },
        (m) => setBusy(m),
      );
      setNewName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [mero, appId, spaceId, newName, load]);

  const open = useCallback(
    async (vault: VaultRow) => {
      if (!mero || !vault.contextId) return;
      setError(null);
      try {
        // Already a member? `enterVaultContext` returns immediately. Otherwise
        // it self-admits into the open subgroup and waits for the identity.
        await enterVaultContext(
          mero.admin,
          { vaultId: vault.vaultId, contextId: vault.contextId },
          (m) => setBusy(m),
        );
        navigate(`/vault/${vault.contextId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [mero, navigate],
  );

  const inviteToSpace = useCallback(async () => {
    if (!mero || !spaceId) return;
    setError(null);
    try {
      const code = await mintSpaceInvite(
        mero.admin,
        { namespaceId: spaceId, spaceName: heading },
        (m) => setBusy(m),
      );
      setInvite({
        code,
        scope: `Whole space · ${heading}`,
        hint: 'Anyone who opens this link can join the space and read every vault in it.',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [mero, spaceId, heading]);

  const inviteToVault = useCallback(
    async (vault: VaultRow) => {
      if (!mero || !spaceId) return;
      setError(null);
      try {
        const code = await mintVaultInvite(
          mero.admin,
          {
            namespaceId: spaceId,
            vaultId: vault.vaultId,
            vaultName: vault.name,
            spaceName: heading,
            contextId: vault.contextId,
          },
          (m) => setBusy(m),
        );
        setInvite({
          code,
          scope: `Opens ${vault.name}`,
          // ⚠️ Said plainly, because it is the one thing about this invitation
          // that can surprise someone: vault access is INHERITED from the
          // space, so there is no such thing as a vault-only grant here.
          hint: `This link lands the recipient in “${vault.name}”, but the access it grants is the whole of ${heading} — every vault in the space, including ones added later.`,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [mero, spaceId, heading],
  );

  if (notInstalled) {
    return (
      <Alert description="Mero Pass is not installed on this node. Install it from the app registry, then reload." />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{heading}</h1>
          <p className="text-gray-600">
            Every vault below is shared with everyone in this space.
          </p>
        </div>
        {mayInvite && (
          <Button
            variant="secondary"
            onClick={() => void inviteToSpace()}
            disabled={!!busy}
          >
            Invite to space
          </Button>
        )}
      </div>

      {error && <Alert description={error} />}
      {busy && <p className="text-sm text-gray-500">{busy}</p>}

      {/* Gated on the real capability mask, not on a role string and not on
          "am I the one who opened this page". A Member sees the explanation
          instead of a button that would 403. */}
      {mayCreateVault ? (
        <Card>
          <CardHeader>
            <CardTitle>New vault</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 items-center">
              <Input
                placeholder="Name it — “Bank logins”, “Production keys”"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1"
                data-testid="vault-name"
              />
              <Button
                onClick={() => void create()}
                disabled={!mero || !appId || !newName.trim() || !!busy}
                data-testid="vault-create"
              >
                Create vault
              </Button>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              The name is written into the vault itself, so it reads the same on
              every member&rsquo;s node.
            </p>
          </CardContent>
        </Card>
      ) : (
        !capabilitiesLoading && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-600">
                You are a Member of this space, so you can open every vault
                below but cannot create new ones. An Admin can promote you under{' '}
                <strong>People in {heading}</strong>.
              </p>
            </CardContent>
          </Card>
        )
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading vaults…</div>
        </div>
      ) : vaults.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-gray-500 mb-4">
              No vaults in this space yet
            </div>
            <div className="text-sm text-gray-400">
              Create one above. Everyone already in the space gets it.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {vaults.map((vault) => (
            <Card key={vault.vaultId}>
              <CardHeader>
                <CardTitle>{vault.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    {vault.memberCount} member
                    {vault.memberCount === 1 ? '' : 's'}
                    {vault.contextId
                      ? vault.joined
                        ? ' · you are in this vault'
                        : ' · you have not joined yet'
                      : ' · not replicated to this node yet'}
                  </p>
                  <div className="flex gap-2 pt-2">
                    <Button
                      className="flex-1"
                      onClick={() => void open(vault)}
                      disabled={!vault.contextId || !!busy}
                    >
                      {vault.joined ? 'Open vault' : 'Join vault'}
                    </Button>
                    {mayInvite && (
                      <Button
                        variant="secondary"
                        onClick={() => void inviteToVault(vault)}
                        disabled={!!busy}
                      >
                        Invite
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {spaceId && (
        <MembersPanel
          namespaceId={spaceId}
          spaceName={heading}
          myAccountId={accountId}
          myCapabilities={capabilities}
          // Demoting yourself is allowed and immediately changes what you may
          // do on this page, so the page's own gates have to be re-read.
          onRolesChanged={() => void refetchCapabilities()}
        />
      )}

      <InviteModal
        open={!!invite}
        code={invite?.code ?? ''}
        scope={invite?.scope ?? ''}
        hint={invite?.hint}
        onClose={() => setInvite(null)}
      />
    </div>
  );
}
