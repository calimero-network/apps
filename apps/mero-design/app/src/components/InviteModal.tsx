import { InviteDialog } from "@calimero-network/mero-react";
import { getApi } from "../api/client";
import { PRODUCT_NAME } from "../api/rpc";
import { inviteLinkBase } from "../utils/inviteLink";

const SUBTITLE = "Choose what the people you invite can do in this team.";

interface Props {
  teamId: string;
  /** The team's name, for the title. */
  teamName: string;
  /** The app team the invite names; empty for an org-wide invite (`teamInviteTeams`). */
  teams?: string[];
  open: boolean;
  onClose: () => void;
}

/**
 * Invite people to the team through the shared dialog: the node's consent page
 * approves the invite, and the link names the team so someone already in it is
 * not offered Join. Mounted once by the shell, which toggles `open`.
 */
export default function InviteModal({ teamId, teamName, teams, open, onClose }: Props) {
  const { client, passkey } = getApi();
  return (
    <InviteDialog
      client={client}
      passkey={passkey()}
      open={open}
      onClose={onClose}
      org={teamId}
      teams={teams}
      appName={PRODUCT_NAME}
      labels={{ title: `Invite to ${teamName}`, subtitle: SUBTITLE }}
      linkBase={inviteLinkBase(teamId)}
    />
  );
}
