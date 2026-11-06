// What a signed-out visitor sees when they open an invitation link: the
// invitation itself, as the whole page, with the passkey sign-in on it. No
// landing hero behind it and no extra click: joining is what they came for.
// Signing in brings up the join prompt (InvitationPrompt) straight away.
//
// "Not now" goes on to the ordinary landing page and keeps the token, so
// signing in later from there still offers the invitation.

import { Button } from '@/components/ui/button';
import { useSession } from '@/calimero/session';
import type { PendingInvite } from '@/hooks/useNamespaceInvitation';
import { SignInPanel } from './SignInPanel';

export function InvitationPage({ invite, onNotNow }: { invite: PendingInvite; onNotNow: () => void }) {
  const api = useSession();
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background px-4 py-6"
      data-testid="invitation-page"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg">
        <SignInPanel invite={invite} />
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onNotNow} disabled={api.busy} data-testid="invitation-not-now">
            Not now
          </Button>
        </div>
      </div>
    </main>
  );
}
