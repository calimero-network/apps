import { useEffect, useState } from "react";

import { GroupApiDataSource } from "../api/dataSource/groupApiDataSource";
import { getStoredGroupAlias } from "../constants/config";
import { resolveWorkspaceName } from "../utils/workspaceName";

/**
 * The name to show for one workspace.
 *
 * Every surface that names a workspace should use this, so they cannot
 * disagree. Settings and the switcher previously read different sources and
 * did: Settings showed "Calimero" from the local alias while the switcher
 * showed a truncated id, which read as a lost name rather than as two answers
 * to one question.
 *
 * Starts from the local alias so a name already in hand renders on the first
 * paint — resolving to a truncated id and correcting it a moment later is a
 * flicker for something that was never unknown — then replaces it with the
 * replicated name (the organization's) when that arrives.
 */
export function useWorkspaceName(groupId: string): string {
  const localAlias = groupId ? getStoredGroupAlias(groupId) : "";
  const [metadataName, setMetadataName] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;

    const api = new GroupApiDataSource();
    void api
      .getGroupMetadata(groupId)
      .then((record) => {
        if (cancelled) return;
        setMetadataName(record?.data?.name ?? null);
      })
      // A workspace whose metadata cannot be read still shows its local name.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [groupId, localAlias]);

  return resolveWorkspaceName({
    metadataName,
    serverAlias: undefined,
    localAlias,
    groupId,
  });
}
