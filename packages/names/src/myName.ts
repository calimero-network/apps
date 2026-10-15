import { useCallback, useEffect } from "react";

import { canonicalAccount } from "./account";
import { memberNames, publishMemberName, type NamesAdmin } from "./directory";
import { useMemberNames } from "./hooks";

const KEY = (namespaceId: string) => `calimero-names:me:${namespaceId}`;

/** The name this browser last used for itself in `namespaceId`, or "". */
export function getStoredMyName(namespaceId: string | null | undefined): string {
  if (!namespaceId) return "";
  try {
    return localStorage.getItem(KEY(namespaceId))?.trim() ?? "";
  } catch {
    return "";
  }
}

function storeMyName(namespaceId: string, name: string): void {
  try {
    if (name) localStorage.setItem(KEY(namespaceId), name);
    else localStorage.removeItem(KEY(namespaceId));
  } catch {
    /* private mode / quota: the replicated record still holds it */
  }
}

export interface MyName {
  /** The name to use for yourself in this team, or "" when you have none. */
  name: string;
  /**
   * True once `name` can be trusted: the team's names have loaded (or failed
   * to), or this browser already knows a name. Ask for a name only when
   * `ready && !name` — asking earlier asks people who already have one.
   */
  ready: boolean;
  /** Set it for the whole team. Resolves once published; throws on refusal. */
  setName: (name: string) => Promise<void>;
}

/**
 * Your name in a team (namespace): one name, set once, used by every
 * project, board, document and app in it.
 *
 * The replicated member record is the truth; this browser keeps a copy so the
 * name is there on the first paint and survives a publish that failed. A copy
 * the record does not have yet is published again, once, when the team's
 * names load.
 */
export function useMyName(
  admin: NamesAdmin | null | undefined,
  namespaceId: string | null | undefined,
  selfAccount: string | null | undefined,
): MyName {
  const { nameOf } = useMemberNames(admin, namespaceId);
  const self = canonicalAccount(selfAccount);
  const shared = self ? nameOf(self) : undefined;
  const stored = getStoredMyName(namespaceId);
  const settled = memberNames.isSettled(namespaceId);

  // The record wins over this browser's copy; keep the copy in step with it.
  useEffect(() => {
    if (namespaceId && shared && shared !== stored) storeMyName(namespaceId, shared);
  }, [namespaceId, shared, stored]);

  // A copy the record never got (an earlier publish failed): send it again.
  useEffect(() => {
    if (!admin || !namespaceId || !self || !settled || shared || !stored) return;
    void publishMemberName(admin, namespaceId, self, stored).catch(() => {});
  }, [admin, namespaceId, self, settled, shared, stored]);

  const setName = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      if (!namespaceId) return;
      storeMyName(namespaceId, trimmed);
      if (self) memberNames.remember(namespaceId, self, trimmed);
      if (!admin || !self) return;
      await publishMemberName(admin, namespaceId, self, trimmed);
    },
    [admin, namespaceId, self],
  );

  const name = shared || stored;
  return { name, ready: !!name || settled, setName };
}
