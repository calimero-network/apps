// The one way into a workspace someone invited you to: open the link they
// sent, and say yes here.
//
// index.tsx takes the invitation off the address bar into storage before the
// app renders (`captureInvite`), so it survives the passkey sign-in on the
// invitation page (InvitationPage). Once the
// session is signed in, this asks (the shared accept dialog, through the
// node's consent page) before redeeming the org invite token; a redeemed
// invite makes the person a member of the workspace's organization (and, for
// a folder invite, of the folder's team), with nothing to sync before the
// workspace opens. Test id: `invite-name`.
//
// For a workspace invite the link names its workspace, so the dialog tells a
// member they are already in it instead of redeeming (which would spend the
// link's use); continuing runs the join follow-up. A folder invite also gives
// a row in the folder's team, which org membership does not prove, so it
// names no org and always asks.
//
// Joining is also where the workspace asks your name, once: when the org has
// none for you yet, the same dialog asks it (`invite-name`) before the
// workspace opens, and every folder and doc in it uses it from then on.

import React, { useCallback, useEffect, useState } from 'react';
import { isSpentInvite } from '@calimero-apps/connect';
import { AcceptInviteDialog } from '@calimero-network/mero-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMero } from '@/calimero/react';
import { useSession } from '@/calimero/session';
import {
  dropInvite,
  pendingInvite,
  takeJoinedAtSignUp,
  type PendingInvite,
} from '@/hooks/useNamespaceInvitation';
import { rememberNamespaceName } from '@/hooks/namespaceNames';
import { setOrgName } from '@calimero-apps/names';
import { SelfNameForm } from './DisplayNameGate';

interface Props {
  /** After a successful join: take the person into the workspace they joined. */
  onJoined: (workspaceId: string | null, folderId: string | null) => void;
}

export function InvitationPrompt({ onJoined }: Props) {
  const { admin, client, isAuthenticated } = useMero();
  const { passkey } = useSession();
  const [invite, setInvite] = useState<PendingInvite | null>(null);
  /** Joined an org that has no name for you: where to go once it has one. */
  const [naming, setNaming] = useState<{ org: string; folder: string | null } | null>(null);

  useEffect(() => {
    setInvite(isAuthenticated ? pendingInvite() : null);
    // Signed up from a page holding the invite: already joined; open what it named.
    const joined = isAuthenticated ? takeJoinedAtSignUp() : null;
    if (joined) onJoined(joined.workspace, joined.folder);
    // `onJoined` is the router's; only the sign-in matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const close = useCallback(() => setInvite(null), []);

  const decline = useCallback(() => {
    dropInvite();
    close();
  }, [close]);

  const joined = useCallback(
    async ({ org }: { org: string }) => {
      if (!admin || !invite) return;
      admin.joined(org);
      if (invite.kind === 'namespace' && invite.targetName) rememberNamespaceName(org, invite.targetName);
      dropInvite();
      setInvite(null);
      const folder = invite.kind === 'group' ? invite.targetId : null;
      // A read that fails leaves it to the workspace's name gate.
      const meta = await admin.getMemberMetadata(org, admin.self).catch(() => undefined);
      if (meta !== undefined && !meta?.name?.trim()) {
        setNaming({ org, folder });
        return;
      }
      onJoined(org, folder);
    },
    [admin, invite, onJoined],
  );

  if (naming) {
    const go = () => {
      setNaming(null);
      onJoined(naming.org, naming.folder);
    };
    return (
      // Closed without a name, the workspace's name gate asks on entry.
      <Dialog open onOpenChange={(open) => !open && go()}>
        <DialogContent data-testid="invite-name">
          <DialogHeader>
            <DialogTitle>Your name in this workspace</DialogTitle>
            <DialogDescription>
              Members of this workspace see this name in every folder and doc. You can change it later in settings.
            </DialogDescription>
          </DialogHeader>
          <SelfNameForm
            onSave={async (name) => {
              if (!admin) throw new Error('Not signed in');
              await setOrgName(admin, naming.org, admin.self, name);
              go();
            }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  if (!invite) return null;
  const named = invite.targetName ? ` “${invite.targetName}”` : '';
  const folderInvite = invite.kind === 'group';
  const noun = folderInvite ? 'folder' : 'workspace';

  return (
    <AcceptInviteDialog
      client={client ?? undefined}
      passkey={passkey()}
      open
      onClose={decline}
      token={invite.token}
      appName="Mero Docs"
      org={invite.kind === 'namespace' ? (invite.workspaceId ?? undefined) : undefined}
      labels={{
        noun,
        title: "You're invited",
        body: `Join the ${noun}${named} in Mero Docs? ${
          folderInvite
            ? "You'll only gain access to this folder, not the rest of the workspace."
            : "You'll be added to the workspace."
        }`,
      }}
      onError={(e) => {
        if (isSpentInvite(e)) dropInvite();
      }}
      onJoined={(j) => void joined(j)}
    />
  );
}
