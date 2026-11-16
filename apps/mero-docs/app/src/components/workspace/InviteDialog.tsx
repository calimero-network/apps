// Invite people to a workspace, or to one folder of it, on the shared dialog:
// it asks the node's consent page, offers Default or Custom permissions and
// shows the link. This resolves where the invite lands (the org and the teams
// it names) each time it opens.

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { InviteDialog as SharedInviteDialog, type InviteLabels } from '@calimero-network/mero-react';
import { appOnlyInviteNote, describeError } from '@calimero-apps/connect';
import { useLive } from '@/calimero/react';
import { useSession } from '@/calimero/session';
import { inviteLinkBase } from '@/hooks/useNamespaceInvitation';

const APP_NAME = 'Mero Docs';

interface Props {
  /** The workspace (org) or the folder (team) people are invited to. */
  groupId: string;
  labels: InviteLabels;
  inviterName?: string;
  open: boolean;
  onClose: () => void;
}

interface Target {
  groupId: string;
  org: string;
  teams: string[];
  appOnly: boolean;
  linkBase: string;
}

export function InviteDialog({ groupId, labels, inviterName, open, onClose }: Props) {
  const live = useLive();
  const { passkey } = useSession();
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    if (!open || !live) return;
    let current = true;
    live.admin.inviteTarget(groupId).then(
      ({ org, team, teams, appOnly }) => {
        const ids = { workspace: org, ...(team ? { folder: team } : {}) };
        if (current) setTarget({ groupId, org, teams, appOnly, linkBase: inviteLinkBase(team ? 'group' : 'namespace', ids) });
      },
      (e) => {
        if (!current) return;
        toast.error(describeError(e));
        onClose();
      },
    );
    return () => {
      current = false;
    };
    // `onClose` is read when the target resolves; only opening matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groupId, live]);

  if (!live || target?.groupId !== groupId) return null;
  return (
    <SharedInviteDialog
      client={live.client}
      passkey={passkey()}
      open={open}
      onClose={onClose}
      org={target.org}
      teams={target.teams}
      appName={APP_NAME}
      inviterName={inviterName}
      labels={target.appOnly ? { ...labels, note: appOnlyInviteNote(APP_NAME) } : labels}
      linkBase={target.linkBase}
    />
  );
}
