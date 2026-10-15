import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useContextGroup, useMero } from "@calimero-network/mero-react";
import { publishMemberName, useMemberNames } from "@calimero-apps/names";
import { displayName } from "./lib/people";

/**
 * The namespace the open team lives in. `ContextPicker` creates every team
 * directly in its namespace, so the context's group IS the namespace — the one
 * group everyone is in, where a person's name for every app is kept.
 */
const NamespaceIdContext = createContext<string | null>(null);
export const NamespaceIdProvider = NamespaceIdContext.Provider;

/** Provide the namespace of the team `contextId` to everything below. */
export function TeamNamespace({ contextId, children }: { contextId: string; children: ReactNode }) {
  const { groupId } = useContextGroup(contextId);
  return <NamespaceIdProvider value={groupId ?? null}>{children}</NamespaceIdProvider>;
}

/**
 * Names people set for the whole namespace: the fallback for anyone who has
 * not named themselves on this team, and where a name picked here is
 * published so every other app shows it too.
 */
export function useSpaceNames() {
  const { admin } = useMero();
  const namespaceId = useContext(NamespaceIdContext);
  const { nameOf } = useMemberNames(admin, namespaceId);

  /** Best-effort: the team name is what was asked for, so a refusal is quiet. */
  const publish = useCallback(
    (account: string | null | undefined, name: string) => {
      if (!admin || !namespaceId || !account || !name.trim()) return;
      void publishMemberName(admin, namespaceId, account, name.trim()).catch(() => undefined);
    },
    [admin, namespaceId],
  );

  return { nameOf, publish };
}

/** What to call `account`: team name, else namespace name, else a short id. */
export function PersonName({ account, name }: { account: string; name?: string | null }) {
  const { nameOf } = useSpaceNames();
  return <>{displayName(account, name, nameOf(account))}</>;
}
