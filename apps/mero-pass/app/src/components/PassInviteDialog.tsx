import { appOnlyInviteNote } from '@calimero-apps/connect';
import { InviteDialog } from '@calimero-network/mero-react';

import { useCalimero } from '../calimero';
import { inviteBase } from '../lib/inviteLink';

/** What an invite dialog is opened for: the teams it names and the wording. */
export interface PassInvite {
  teams: string[];
  /** The team named in the link; see `inviteBase`. */
  linkOrg?: string;
  title: string;
  subtitle: string;
  /** The link gives Mero Pass only (an org that keeps its apps apart). */
  appOnly?: boolean;
}

const EXPIRY_OPTIONS = [60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60]; // 1 hour, 1 day, 7 days
const DEFAULT_TTL = 24 * 60 * 60;

/**
 * The shared invite dialog for `org`. Mounted for the page's life and opened by
 * `invite`: a full-page approval returns here and the dialog finishes it.
 */
export default function PassInviteDialog({
  org,
  invite,
  onClose,
}: {
  org: string;
  invite: PassInvite | null;
  onClose: () => void;
}) {
  const { client, passkey } = useCalimero();
  if (!client) return null;
  return (
    <InviteDialog
      client={client}
      passkey={passkey()}
      open={!!invite}
      onClose={onClose}
      org={org}
      teams={invite?.teams}
      appName="Mero Pass"
      linkBase={inviteBase(invite?.linkOrg)}
      uses={1}
      ttlSecs={DEFAULT_TTL}
      expiryOptions={EXPIRY_OPTIONS}
      labels={{
        noun: 'team',
        ...(invite && { title: invite.title, subtitle: invite.subtitle }),
        ...(invite?.appOnly && { note: appOnlyInviteNote('Mero Pass') }),
      }}
    />
  );
}
