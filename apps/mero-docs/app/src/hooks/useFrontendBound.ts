// Whether this session is bound to Docs' own frontend, where every
// organization-wide change is approved one at a time on the node's consent
// page (`calimero/consent.ts`). `null` until known.

import { useEffect, useState } from 'react';
import { isFrontendBound } from '@calimero-apps/connect';
import { useMero } from '@/calimero/react';

export function useFrontendBound(): boolean | null {
  const { client } = useMero();
  const [bound, setBound] = useState<boolean | null>(null);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void isFrontendBound(client).then((b) => {
      if (live) setBound(b);
    });
    return () => {
      live = false;
    };
  }, [client]);
  return client ? bound : null;
}
