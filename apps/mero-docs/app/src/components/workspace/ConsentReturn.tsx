// Finishes what Docs sent the person to the node's consent page for, when the
// page sends them back (`calimero/consent.ts`): a role, permissions or a
// removal is said; a workspace left or deleted is closed, back to the
// workspace list. What the approval did is read from the node's sealed result,
// never from the return URL, and a return that does not match the request
// this tab started is refused by `resumeConsent`.

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { consentReturn } from '@calimero-network/mero-js';
import { askOrgConsent, consentIntent, returnFromConsent, stayedInDocs } from '@/calimero/consent';
import { useMero } from '@/calimero/react';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';

const DONE: Record<string, string> = {
  setMemberRole: 'Their role in this workspace was changed.',
  setCapabilities: 'The permissions were changed.',
  removeMember: 'They were removed from the workspace.',
  leaveOrg: 'You left the workspace.',
  deleteOrg: 'The workspace was deleted.',
};

export function ConsentReturn() {
  const { client } = useMero();
  const { namespaceId, clearNamespace, refetch } = useDriveWorkspace();
  const started = useRef(false);
  const current = useRef({ namespaceId, clearNamespace, refetch });
  current.current = { namespaceId, clearNamespace, refetch };

  useEffect(() => {
    // Only a return this app kept an intent for: the shared dialogs resume their own.
    if (!client || started.current || !consentReturn(window.location.href) || !consentIntent()) return;
    started.current = true;
    void (async () => {
      let back;
      try {
        back = await returnFromConsent(client);
      } catch (e) {
        console.warn('[ConsentReturn] the consent page’s return was refused', e);
        toast.error('Nothing was changed', {
          description: 'This approval did not come from the request Docs made. Try again from Docs.',
        });
        return;
      }
      if (!back) return;
      if (!back.approved) {
        toast('Not approved', { description: 'Nothing was changed.' });
        return;
      }
      const { intent } = back;
      // A role whose permissions differ too: those are a request of their own.
      if (intent?.kind === 'setMemberRole' && intent.then) {
        toast.success('Their role was changed. Next, approve the permissions that come with it.');
        try {
          await askOrgConsent(client, intent.then);
        } catch (e) {
          if (!stayedInDocs(e)) console.warn('[ConsentReturn] the permissions were not asked for', e);
          toast('Permissions not changed', {
            description: 'Their role changed; pick the role again to set the permissions that come with it.',
          });
          await current.current.refetch().catch(() => undefined);
        }
        return;
      }
      if (DONE[back.kind]) toast.success(DONE[back.kind]);
      const here = current.current;
      // Out of the workspace this tab was in: back to the workspace list.
      if ((back.kind === 'leaveOrg' || back.kind === 'deleteOrg') && intent?.org === here.namespaceId) {
        here.clearNamespace();
      }
      await here.refetch().catch(() => undefined);
    })();
  }, [client]);

  return null;
}
