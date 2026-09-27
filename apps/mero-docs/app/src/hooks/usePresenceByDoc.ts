// Who has each doc open right now, read from the same presence slices the
// editor publishes, so Home can say "Bob is here" without opening anything.

import { createContext, useContext, useMemo } from 'react';
import { useEphemeral } from '@calimero-network/mero-react';
import { UNNAMED_MEMBER_LABEL } from '@/components/common/MemberLabel';
import { presenceColour, type DocPresence } from '@/lib/rich/presence';
import { rowKey } from '@/lib/workspaceIndex/types';

export type DocPeer = { id: string; name: string; colour: string };
export type PresenceByDoc = Map<string, DocPeer[]>; // keyed by rowKey

export const PresenceByDocContext = createContext<PresenceByDoc>(new Map());

/** Readers per doc across the workspace, yourself excluded. */
export function usePresenceByDoc(): PresenceByDoc {
  return useContext(PresenceByDocContext);
}

/** One folder's readers per doc. A slice is peer-written, so its shape is checked. */
export function peersByDoc(
  folderId: string,
  peers: ReadonlyMap<string, unknown>,
): PresenceByDoc {
  const out: PresenceByDoc = new Map();
  for (const [author, raw] of peers) {
    const slice = (raw ?? {}) as Partial<DocPresence>;
    if (typeof slice.docId !== 'string' || !slice.docId) continue;
    const key = rowKey(folderId, slice.docId);
    const name =
      typeof slice.name === 'string' && slice.name.trim()
        ? slice.name
        : UNNAMED_MEMBER_LABEL;
    const colour =
      typeof slice.colour === 'string' ? slice.colour : presenceColour(author);
    out.set(key, [...(out.get(key) ?? []), { id: author, name, colour }]);
  }
  return out;
}

/** The readers in one folder's docs context; useEphemeral leaves this node out. */
export function useFolderPresence(
  folderId: string,
  contextId: string,
): PresenceByDoc {
  const { peers } = useEphemeral<DocPresence>(contextId);
  return useMemo(() => peersByDoc(folderId, peers), [folderId, peers]);
}
