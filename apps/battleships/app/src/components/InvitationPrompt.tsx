import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';
import {
  InviteStatusBanner,
  useInviteRedemption,
  type InviteRedeemer,
  type ParsedInvitation,
} from '@calimero-apps/invite';
import { readLobbyInvitation, type LobbyInvitation } from '../utils/invitation';
import { lobbyRedeemer } from '../utils/redeemLobby';
import { setStoredLobbyName } from '../utils/lobbyName';
import { addKnownPlayer } from '../utils/knownPlayers';

/** Router state the lobby page reads to refresh its list after a join lands. */
export interface JoinedLobbyState {
  joinedLobbyId: string;
}

/** How long a successful join stays on screen before the banner clears. */
const JOINED_BANNER_MS = 4_000;

/** Never called: the hook is disabled until there is a client to join with. */
const NO_CLIENT: InviteRedeemer = {
  join: () => Promise.reject(new Error('Not connected to a node')),
  memberships: () => Promise.reject(new Error('Not connected to a node')),
};

/**
 * "You have been invited to <lobby>" — for an invitation that arrived as a link.
 *
 * An invitation reaches Battleships only by its link being opened: the links
 * page appends `?invitation=…` to this app's URL, and a running desktop sends a
 * `deep-link` event. Both are captured at boot (src/index.tsx) and buffered
 * until a session can join, so this is mounted above the routes: the link can
 * land on the landing page, `/home` or a match, and the prompt still shows.
 *
 * It asks first. Joining gives someone else's lobby a peer on this node, so a
 * forwarded link or a refreshing tab must not do it silently.
 *
 * After the join it lands on the lobby page with router state naming the lobby:
 * the page re-reads its list until the lobby is there, then enters it. Without
 * that it would not re-read a list that is already on screen.
 */
export default function InvitationPrompt() {
  const { mero, isAuthenticated } = useMero();
  const navigate = useNavigate();
  // What the token carried beyond the hook's `ParsedInvitation`: the node's
  // group alias for the join body, and the extras stored once it lands.
  const lobbyRef = useRef<LobbyInvitation | null>(null);

  const parse = useCallback((token: string): ParsedInvitation | null => {
    const lobby = readLobbyInvitation(token);
    lobbyRef.current = lobby;
    return lobby
      ? {
          namespaceId: lobby.namespaceId,
          invitation: lobby.invitation,
          teamName: lobby.lobbyName,
        }
      : null;
  }, []);

  const redeemer = useMemo(
    () =>
      mero
        ? lobbyRedeemer(mero.admin, () => lobbyRef.current?.groupAlias)
        : NO_CLIENT,
    [mero],
  );

  const onJoined = useCallback(
    (namespaceId: string) => {
      const lobby = lobbyRef.current;
      // The joining node has no server-side name until the metadata syncs, and
      // it never lists the inviter's player key on its own: both come from the
      // link, so the lobby has a name and an opponent the moment it opens.
      if (lobby?.namespaceId === namespaceId) {
        if (lobby.lobbyName) setStoredLobbyName(namespaceId, lobby.lobbyName);
        if (lobby.inviterKey) addKnownPlayer(namespaceId, lobby.inviterKey);
      }
      const state: JoinedLobbyState = { joinedLobbyId: namespaceId };
      navigate('/lobby', { state });
    },
    [navigate],
  );

  const { state, accept, decline, retry, dismiss } = useInviteRedemption({
    parse,
    redeemer,
    onJoined,
    enabled: isAuthenticated && !!mero,
  });

  useEffect(() => {
    if (state.stage !== 'joined' && state.stage !== 'already-member')
      return undefined;
    const timer = setTimeout(dismiss, JOINED_BANNER_MS);
    return () => clearTimeout(timer);
  }, [state.stage, dismiss]);

  if (state.stage === 'idle') return null;
  return (
    <div className="invite-prompt">
      <InviteStatusBanner
        state={state}
        noun="lobby"
        onAccept={accept}
        onDecline={decline}
        onRetry={retry}
        onDismiss={dismiss}
        style={{
          background: 'var(--bg-card)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
        }}
      />
    </div>
  );
}
