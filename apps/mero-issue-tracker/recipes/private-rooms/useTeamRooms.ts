/**
 * RECIPE: public/private rooms as teams of the organization, each room an app
 * instance reachable by its team. Reference code; copy into app/src/hooks/.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AppInfo, CalimeroClient, PasskeyProvider } from '@calimero-network/mero-js';
import type { AppSource } from '@calimero-apps/connect';

export type RoomVisibility = 'public' | 'private';

type Client = Pick<CalimeroClient, 'listApps' | 'createTeam' | 'createApp' | 'setTeamMember'>;

export function useTeamRooms(client: Client, source: AppSource, org: string | null) {
  const [rooms, setRooms] = useState<AppInfo[]>([]);

  const refresh = useCallback(async () => {
    if (!org) return setRooms([]);
    const filter = typeof source === 'string' ? { bundle: source } : { package: source.package };
    // The node lists only the instances this account reaches.
    setRooms((await client.listApps(filter)).filter((a) => a.org === org));
  }, [client, source, org]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** A room: its team, then its app instance reachable by that team. Private rooms add `members`. */
  const createRoom = useCallback(
    async (name: string, visibility: RoomVisibility, members: string[], passkey: () => PasskeyProvider) => {
      if (!org) throw new Error('no organization');
      const team = await client.createTeam(org, name, visibility === 'public' ? 'everyone' : 'invite');
      const appId = await client.createApp(name, source, { org, access: { kind: 'team', team } });
      if (visibility === 'private') {
        for (const account of members) await client.setTeamMember(org, team, account, passkey());
      }
      await refresh();
      return appId;
    },
    [client, source, org, refresh],
  );

  return { rooms, createRoom, refresh };
}
