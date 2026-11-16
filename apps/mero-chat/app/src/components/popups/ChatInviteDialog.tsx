import { useEffect, useMemo, useState } from "react";
import { InviteDialog } from "@calimero-network/mero-react";
import { appOnlyInviteNote, isAppOnly, type AppOrgView } from "@calimero-apps/connect";

import { passkey, useCalimero } from "../../api/calimero";
import { chatPackage, chatTeamId, getOrgRecord } from "../../api/platform";
import { getMessengerDisplayName } from "../../utils/messengerName";

const APP_NAME = "Hyperfeed Chat";
const LABELS = { title: "Invite to workspace", subtitle: "Choose what the people you invite can do in Hyperfeed Chat." };

/**
 * The shared invite dialog for a workspace, naming Chat's app team where it
 * has one so the invitee gets Chat and no other app. Mounted once with the
 * invite button: it also finishes an invite approved on a full-page trip.
 */
export default function ChatInviteDialog({ groupId, open, onClose }: { groupId: string; open: boolean; onClose: () => void }) {
  const { session: current } = useCalimero();
  const session = current?.status === "signed-in" ? current : null;
  const [target, setTarget] = useState<{ teams: string[]; appOnly: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    setTarget(null);
    getOrgRecord(groupId).then(
      (record) =>
        live &&
        setTarget({
          teams: [chatTeamId(record)].filter((t): t is string => !!t),
          appOnly: isAppOnly(record as AppOrgView, chatPackage()),
        }),
      () => live && setTarget({ teams: [], appOnly: false }),
    );
    return () => {
      live = false;
    };
  }, [groupId]);

  // The link names the workspace, so someone already in it is not offered Join.
  const linkBase = useMemo(() => {
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set("org", groupId);
    return url.toString();
  }, [groupId]);

  if (!session || !target) return null;
  return (
    <InviteDialog
      client={session.client}
      passkey={passkey()}
      open={open}
      onClose={onClose}
      org={groupId}
      teams={target.teams}
      appName={APP_NAME}
      uses={1}
      inviterName={getMessengerDisplayName(groupId) || undefined}
      labels={target.appOnly ? { ...LABELS, note: appOnlyInviteNote(APP_NAME) } : LABELS}
      linkBase={linkBase}
    />
  );
}
