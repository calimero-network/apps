/**
 * RECIPE: public/private rooms as teams of the organization, each room an app
 * instance reachable by its team. Reference code; copy into app/src/hooks/.
 */
import { useCallback, useEffect, useState } from 'react';
import { passkeyConfirm, type AppInfo, type PasskeyProvider } from '@calimero-network/mero-js';
import { appTarget, listAppInfos, type AppSource, type ClientRoutes } from '@calimero-apps/connect';

export type RoomVisibility = 'public' | 'private';

type Client = ClientRoutes<{ apps: 'list' | 'create'; orgs: 'teamCreate' | 'teamSetMember' }>;

export function useTeamRooms(client: Client, source: AppSource, org: string | null) {
  const [rooms, setRooms] = useState<AppInfo[]>([]);

  const refresh = useCallback(async () => {
    if (!org) return setRooms([]);
    const filter = typeof source === 'string' ? { bundle: source } : { package: source.package };
    // The node lists only the instances this account reaches.
    setRooms((await listAppInfos(client, filter)).filter((a) => a.org === org));
  }, [client, source, org]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** A room: its team, then its app instance reachable by that team. Private rooms add `members`. */
  const createRoom = useCallback(
    async (name: string, visibility: RoomVisibility, members: string[], passkey: () => PasskeyProvider) => {
      if (!org) throw new Error('no organization');
      const join = visibility === 'public' ? 'everyone' : 'invite';
      const { teamId: team } = await client.orgs.teamCreate({ org, name, join });
      const { appId } = await client.apps.create({ name, ...appTarget(source), org, access: { kind: 'team', team } });
      if (visibility === 'private') {
        for (const account of members) {
          await client.orgs.teamSetMember({ org, team, account }, { confirm: passkeyConfirm(passkey()) });
        }
      }
      await refresh();
      return appId;
    },
    [client, source, org, refresh],
  );

  return { rooms, createRoom, refresh };
}
