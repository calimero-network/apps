import { useEffect, useRef, useState } from "react";
import { InviteDialog } from "@calimero-network/mero-react";
import { useSignedIn } from "../api/sessionContext";
import { NoAppTeamError, appInviteTeams, appOnlyInviteNote } from "@calimero-apps/connect";
import { PRODUCT_NAME, inviteLinkBase } from "../api/teams";

const LABELS = {
  noun: "team",
  title: "Invite to team",
  subtitle: "Opening the link and signing in with a passkey joins this team. Choose what the people you invite can do.",
};

/** The shared invite dialog for one team, naming this app's team in the invite. */
export default function TeamInviteDialog({ teamId, open, onClose }: { teamId: string; open: boolean; onClose: () => void }) {
  const { client, passkey, source } = useSignedIn();
  const [teams, setTeams] = useState<{ teams: string[]; appOnly: boolean } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    let live = true;
    // Unreadable: the invite then goes org-wide, as in a legacy team. A team set without this app is never widened.
    appInviteTeams(client, teamId, source).then(
      (t) => live && setTeams(t),
      (e) => live && (e instanceof NoAppTeamError ? close.current() : setTeams({ teams: [], appOnly: false })),
    );
    return () => {
      live = false;
      setTeams(null);
    };
  }, [open, client, teamId, source]);

  return (
    <InviteDialog
      client={client}
      passkey={passkey()}
      open={open && teams !== null}
      onClose={onClose}
      org={teamId}
      teams={teams?.teams}
      appName={PRODUCT_NAME}
      uses={1}
      labels={teams?.appOnly ? { ...LABELS, note: appOnlyInviteNote(PRODUCT_NAME) } : LABELS}
      linkBase={inviteLinkBase(teamId)}
    />
  );
}
