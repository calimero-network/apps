import { useEffect, useRef, useState } from "react";
import { AcceptInviteDialog } from "@calimero-network/mero-react";
import { isSpentInvite } from "@calimero-apps/connect";
import { lastUsedName } from "@calimero-apps/names";

import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { setStoredGroupAlias } from "../../constants/config";
import { getMessengerDisplayName } from "../../utils/messengerName";
import { invalidate } from "../../api/platform";
import { getAccountId, passkey, useCalimero } from "../../api/calimero";
import {
  dropInvite,
  pendingInvite,
  pendingInviteOrg,
  setInvitePromptOpen,
} from "../../utils/invitation";
import { enterJoinedWorkspaceForName, enterWorkspace } from "../../utils/enterWorkspace";
import { log } from "../../utils/logger";

const LABELS = {
  title: "You're invited to a workspace",
  body: "Join it to see its channels and message its members in Hyperfeed Chat.",
  join: "Join workspace",
};

/**
 * Offers an opened invitation link once the person is signed in: the shared
 * accept dialog redeems the org invite token and the workspace is entered
 * under their name (asked for only if they have none). The token was taken off the address bar before React
 * mounted (`captureInvite` in `main.tsx`), so it survives the passkey sign-up
 * on the invitation page (`pages/Login/InvitationPage`).
 *
 * When the link names its workspace (`&org=`) the dialog tells a member they
 * are already in it instead of redeeming (which spends the link's use), and
 * continuing enters the workspace as a join does.
 */

interface Props {
  enabled: boolean;
}

export default function InvitationPrompt({ enabled }: Props) {
  const api = useRef(new GroupApiDataSource());
  const { session: current } = useCalimero();
  const session = current?.status === "signed-in" ? current : null;
  const [invite, setInvite] = useState<{ token: string; org: string | null } | null>(null);
  // Hides the dialog while the workspace is entered; the prompt itself stays, so the picker keeps waiting.
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    const token = enabled ? pendingInvite() : null;
    setInvite(token ? { token, org: pendingInviteOrg() } : null);
  }, [enabled]);

  // The workspace picker waits while this is on screen (`invitationInFlight`).
  useEffect(() => {
    setInvitePromptOpen(invite !== null);
    return () => setInvitePromptOpen(false);
  }, [invite]);

  if (!invite || !session) return null;

  const dismiss = () => {
    dropInvite();
    setInvite(null);
  };

  // One name per person: the one they gave this workspace, else the one they last used.
  const enter = (groupId: string, memberIdentity: string) => {
    const name = getMessengerDisplayName(groupId) || lastUsedName();
    if (name) void enterWorkspace(api.current, groupId, name, memberIdentity);
    else enterJoinedWorkspaceForName(groupId);
  };

  const onJoined = async ({ org }: { org: string }) => {
    dropInvite();
    setJoined(true);
    invalidate();
    const meta = await api.current.getGroupMetadata(org).catch(() => null);
    const alias = meta?.data?.name?.trim();
    if (alias) setStoredGroupAlias(org, alias);
    log.info("InvitationPrompt", `joined workspace ${org}`);
    enter(org, getAccountId());
  };

  return (
    <AcceptInviteDialog
      client={session.client}
      passkey={passkey()}
      open={!joined}
      onClose={dismiss}
      token={invite.token}
      org={invite.org ?? undefined}
      appName="Hyperfeed Chat"
      labels={LABELS}
      onError={(e) => {
        if (isSpentInvite(e)) dropInvite();
      }}
      onJoined={onJoined}
    />
  );
}
