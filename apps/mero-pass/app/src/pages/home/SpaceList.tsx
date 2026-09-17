import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useApplicationId } from '../../hooks/useApplicationId';
import {
  createSpace,
  listSpaces,
  mintSpaceInvite,
  type SpaceRow,
} from '../../lib/vaults';

/**
 * The spaces this node holds for Mero Pass, and the two things the app could
 * not do before: MAKE one, and INVITE someone to it.
 *
 * What was here read `admin.getContexts()` — every context on the node,
 * whichever app created it — called each one a vault, labelled it
 * `Vault 3f8a91c2…` from its own id, and told the user that vaults appear "when
 * you join a namespace that has one — ask whoever runs it for an invitation".
 * There was no create path and no invite path anywhere in the app, so that
 * sentence described a dead end rather than a workflow.
 */
export default function SpaceList() {
  const { mero } = useMero();
  const navigate = useNavigate();
  const { appId, resolving, notInstalled } = useApplicationId();

  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string; scope: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!mero || !appId) {
      setLoading(resolving);
      return;
    }
    setLoading(true);
    try {
      setSpaces(await listSpaces(mero.admin, appId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mero, appId, resolving]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!mero || !appId || !name) return;
    setError(null);
    try {
      // The name goes to the node at creation. This is the whole point: a name
      // kept only in this browser is a name nobody invited will ever see.
      const { namespaceId } = await createSpace(
        mero.admin,
        { applicationId: appId, name },
        (m) => setBusy(m),
      );
      setNewName('');
      await load();
      navigate(`/space/${namespaceId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [mero, appId, newName, load, navigate]);

  const inviteTo = useCallback(
    async (space: SpaceRow) => {
      if (!mero) return;
      setError(null);
      try {
        const code = await mintSpaceInvite(
          mero.admin,
          { namespaceId: space.namespaceId, spaceName: space.name },
          (m) => setBusy(m),
        );
        setInvite({ code, scope: `Whole space · ${space.name}` });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [mero],
  );

  const filtered = spaces.filter((s) =>
    s.name.toLowerCase().includes(query.trim().toLowerCase()),
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
          <h1 className="text-3xl font-bold">Spaces</h1>
          <p className="text-gray-600">
            A space is a group of people. The vaults inside it are shared with
            everyone you invite.
          </p>
        </div>
      </div>

      {error && <Alert description={error} />}
      {busy && <p className="text-sm text-gray-500">{busy}</p>}

      <Card>
        <CardHeader>
          <CardTitle>New space</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 items-center">
            <Input
              placeholder="Name it — “Home”, “Ops”, “Acme Ltd”"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1"
              data-testid="space-name"
            />
            <Button
              onClick={() => void create()}
              disabled={!mero || !appId || !newName.trim() || !!busy}
              data-testid="space-create"
            >
              Create space
            </Button>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            The name travels with the space, so everyone you invite sees the one
            you type here.
          </p>
        </CardContent>
      </Card>

      <div className="max-w-md">
        <Input
          placeholder="Search spaces..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading spaces…</div>
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-gray-500 mb-4">
              {query ? 'No spaces match your search' : 'No spaces yet'}
            </div>
            <div className="text-sm text-gray-400">
              Create one above, or open an invitation link someone sent you —
              accepting it puts the space here.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((space) => (
            <Card key={space.namespaceId}>
              <CardHeader>
                <CardTitle>{space.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    {space.vaultCount} vault{space.vaultCount === 1 ? '' : 's'}{' '}
                    · {space.memberCount} member
                    {space.memberCount === 1 ? '' : 's'}
                  </p>
                  <div className="flex gap-2 pt-2">
                    <Button
                      className="flex-1"
                      onClick={() => navigate(`/space/${space.namespaceId}`)}
                    >
                      Open
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void inviteTo(space)}
                      disabled={!!busy}
                    >
                      Invite
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <InviteModal
        open={!!invite}
        code={invite?.code ?? ''}
        scope={invite?.scope ?? ''}
        hint="Anyone who opens this link can join the space and read every vault in it."
        onClose={() => setInvite(null)}
      />
    </div>
  );
}
