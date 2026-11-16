/**
 * "Join this workspace?" for an invitation that arrived as a link (`?invite=`,
 * taken into storage before the first render: see `captureInvite`).
 *
 * Mounted at the APP level because a link can land on any route, and it asks
 * rather than joins: joining puts you in someone's organization, and a
 * forwarded link or a refreshing background tab should not do that silently.
 * The asking is the shared `AcceptInviteDialog`, which goes through the node's
 * consent page and says the node's own refusal.
 *
 * Signed out, `InvitationPage` stands in for the app and offers the sign-in;
 * the token survives a sign-in, and this asks the moment a session exists. A
 * sign-up from that page already joined with it (`api.joinedInvite`): this
 * only opens what the link named, with nothing redeemed again.
 * The dialog is given the link's org: someone already in the workspace (the
 * inviter opening their own link) is told so and nothing is redeemed, which
 * would spend the single use. A spent invite is dropped from storage but its
 * refusal stays on screen until "Not now". Joining reports what to open: the
 * spreadsheet the link names, or the workspace's list.
 *
 * Joining is also where the workspace asks your name, once: when it has none
 * for you yet, the name question (`NicknameModal`) comes up before the
 * spreadsheet opens, and every spreadsheet in the workspace uses it after.
 */
import { useCallback, useEffect, useState } from 'react';
import { APP_DISPLAY_NAME } from '../config';
import { lastUsedName } from '@calimero-apps/names';
import { describeError } from '../utils/errors';
import { isSpentInvite } from '@calimero-apps/connect';
import { AcceptInviteDialog } from '@calimero-network/mero-react';
import { useMaybeSignedIn, useSessionApi } from '../sessionContext';
import {
  dropInvite,
  pendingInvite,
  publishWorkspaceName,
  readMembers,
  type AcceptedInvite,
  type PendingInvite,
} from '../lib/workspaces';
import NicknameModal from './NicknameModal';
import { rememberedName, skipWorkspaceName } from '../lib/displayName';

export default function InvitationPrompt({ onJoined }: { onJoined: (landed: AcceptedInvite) => void }) {
  const signedIn = useMaybeSignedIn();
  const { api } = useSessionApi();
  const joinedInvite = api.joinedInvite ?? null;
  const [invite, setInvite] = useState<PendingInvite | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [joinedAtSignUp, setJoinedAtSignUp] = useState<PendingInvite | null>(null);
  /** Joined a workspace that has no name for you: where to go once it has one. */
  const [naming, setNaming] = useState<AcceptedInvite | null>(null);
  const [namingError, setNamingError] = useState<string | null>(null);
  const client = signedIn?.client ?? null;

  // Signing in on the invitation page leaves the token where it was: re-read it.
  // Signing up there joined with it already: open what it named, ask nothing.
  useEffect(() => {
    if (!client) return;
    if (invite && invite.token === joinedInvite) {
      setInvite(null);
      setJoinedAtSignUp(invite);
      return;
    }
    setInvite((prev) => reread(prev));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per session; `joinedInvite` is set before it signs in
  }, [client]);

  // Opened one render later: the landing page's own redirect into the app
  // runs in the sign-in's render, and would replace this navigation's state.
  useEffect(() => {
    if (!joinedAtSignUp) return;
    setJoinedAtSignUp(null);
    onJoined({ namespaceId: joinedAtSignUp.org, contextId: joinedAtSignUp.sheet });
  }, [joinedAtSignUp, onJoined]);

  const dismiss = useCallback(() => {
    dropInvite();
    setInvite(null);
  }, []);

  const joined = useCallback(
    async ({ org }: { org: string }) => {
      if (!signedIn || !invite) return;
      dropInvite();
      setInvite(null);
      const landed = { namespaceId: org, contextId: invite.sheet };
      // A read that fails leaves the question to the first spreadsheet opened.
      const members = await readMembers(signedIn.client, org).catch(() => null);
      signedIn.after();
      if (members && !members.names.get(signedIn.accountId)) {
        setNaming(landed);
        return;
      }
      onJoined(landed);
    },
    [signedIn, invite, onJoined],
  );

  if (signedIn && naming?.namespaceId) {
    const org = naming.namespaceId;
    const go = () => {
      setNaming(null);
      setNamingError(null);
      onJoined(naming);
    };
    return (
      <NicknameModal
        initialName={lastUsedName() || rememberedName()}
        saving={busy}
        error={namingError}
        onSubmit={(name) => {
          setBusy(true);
          setNamingError(null);
          publishWorkspaceName(signedIn.client, org, signedIn.accountId, name)
            .then(go, (e: unknown) => setNamingError(describeError(e)))
            .finally(() => {
              setBusy(false);
              signedIn.after();
            });
        }}
        onSkip={() => {
          skipWorkspaceName(org);
          go();
        }}
      />
    );
  }

  if (!signedIn || !invite) return null;

  return (
    <AcceptInviteDialog
      open
      client={signedIn.client}
      passkey={signedIn.passkey()}
      token={invite.token}
      org={invite.org ?? undefined}
      appName={APP_DISPLAY_NAME}
      onClose={dismiss}
      onError={(e) => {
        if (isSpentInvite(e)) dropInvite();
      }}
      onJoined={(j) => void joined(j)}
    />
  );
}

/**
 * The invitation to ask about once there is a session: the one already held,
 * or the stored one. Never a fresh copy of the one held: a spent invite is
 * dropped from storage while its refusal is still on screen.
 */
function reread(prev: PendingInvite | null): PendingInvite | null {
  return prev ?? pendingInvite();
}
