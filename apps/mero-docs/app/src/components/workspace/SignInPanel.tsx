// The body of the sign-in: a title, what an account is, the cluster it is on,
// and "Continue with passkey" / "Create a passkey". One component for the
// sign-in dialog and the invitation page, so the two never say different
// things or run different ceremonies. `invite` switches the copy to the
// invitation's: the visitor came to join, and signing in is how they accept.

import { AppListing, PasskeySignIn } from '@calimero-apps/passkey';
import '@calimero-apps/passkey/passkey.css';
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LISTING, describeTarget, useSession } from '@/calimero/session';
import { inviteScope, type PendingInvite } from '@/hooks/useNamespaceInvitation';

export function SignInPanel({
  invite,
  inDialog = false,
}: {
  invite: PendingInvite | null;
  /** Inside a Radix dialog, whose title and description it then labels. */
  inDialog?: boolean;
}) {
  const api = useSession();
  const where =
    api.session.status === 'signed-out' || api.session.status === 'signed-in'
      ? describeTarget(api.session.target)
      : null;

  const title = invite ? "You're invited" : 'Sign in';
  const named = invite?.targetName ? ` “${invite.targetName}”` : '';
  const body = (
    <>
      {invite
        ? `You've been invited to join a ${inviteScope(invite)}${named} in Mero Docs. `
        : ''}
      Accounts are passkeys: nothing to remember, nothing to leak.
      {where ? ` Connected to ${where}.` : ''}
    </>
  );

  return (
    <>
      {inDialog ? (
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription data-testid="signin-desc">{body}</DialogDescription>
        </DialogHeader>
      ) : (
        <div className="mb-3 flex flex-col gap-1">
          <h1 className="text-base font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground" data-testid="signin-desc">
            {body}
          </p>
        </div>
      )}

      {api.session.status === 'connecting' && (
        <p className="text-sm text-muted-foreground">Connecting…</p>
      )}
      {api.session.status === 'listing' && <AppListing {...LISTING} />}
      {api.session.status === 'unconfigured' && (
        <p className="text-sm text-destructive" role="alert">
          {api.session.message}
        </p>
      )}
      {api.session.status === 'signed-out' && (
        <PasskeySignIn
          api={api}
          invited={invite !== null}
          joining={invite ? `the ${inviteScope(invite)}` : undefined}
        />
      )}
    </>
  );
}
