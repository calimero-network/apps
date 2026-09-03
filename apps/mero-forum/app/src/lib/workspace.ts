/**
 * The forum this node reads and writes — resolved, created, or joined.
 *
 * WHAT WAS WRONG BEFORE
 *
 * `useForumContext` took `getContexts().contexts[0]`: the first context on the
 * node, whatever application it belonged to. On a node running more than one
 * Calimero app that is somebody else's context, and every forum call against it
 * came back as a `FunctionCallError` — the method does not exist on that
 * contract. "I cannot tell which context is mine" and "the first one is mine"
 * are different answers, and only the first one is true.
 *
 * There was also no way to MAKE one. A fresh node has no namespace and no
 * context, so the feed was permanently empty and the composer could only throw.
 * The app offered nothing that would change that.
 *
 * This module owns all of it: it scopes discovery to this application, and it
 * can create a forum (namespace + context) or join one from an invite.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useMero,
  useNamespacesForApplication,
  useGroupContexts,
  useCreateNamespaceInvitation,
  useJoinNamespace,
} from "@calimero-network/mero-react";

// Members may create contexts and invite others. Mirrors core's
// MemberCapabilities bits (CAN_CREATE_CONTEXT | CAN_INVITE_MEMBERS).
const DEFAULT_CAPABILITIES = 1 | 2; // = 3

const ACTIVE_KEY = "mero-forum:active-context";

function readActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeActive(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* private mode / blocked storage — selection just does not persist */
  }
}

export interface ForumWorkspace {
  /** The application id, from the login callback. Null until authenticated. */
  applicationId: string | null;
  /** The active forum context, or null when there is none to show. */
  contextId: string | null;
  /** The namespace that context belongs to — what an invitation is minted on. */
  namespaceId: string | null;
  /** True while discovery is still running. Distinct from "nothing found". */
  loading: boolean;
  /** True once discovery has finished and found no forum at all. */
  needsSetup: boolean;

  createForum: (name: string) => Promise<string | null>;
  createLoading: boolean;
  createError: string | null;

  joinForum: (invitation: string) => Promise<void>;
  joinLoading: boolean;
  joinError: string | null;

  invite: () => Promise<unknown>;
  inviteLoading: boolean;

  select: (contextId: string) => void;
  /** Every forum context this node can see, for a switcher. */
  contexts: { contextId: string; name: string }[];
}

export function useForumWorkspace(): ForumWorkspace {
  const { mero, applicationId, contextId: callbackContextId } = useMero();

  // Scoped to THIS application, which is the whole point — see the file header.
  const { namespaces, loading: nsLoading, refetch: refetchNamespaces } =
    useNamespacesForApplication(applicationId);

  const namespaceId = namespaces[0]?.namespaceId ?? null;
  const { contexts: groupContexts, loading: ctxLoading, refetch: refetchContexts } =
    useGroupContexts(namespaceId);

  const { createNamespaceInvitation, loading: inviteLoading } =
    useCreateNamespaceInvitation();
  const { joinNamespace } = useJoinNamespace();

  const contexts = useMemo(
    () =>
      groupContexts.map((c) => ({
        contextId: c.contextId,
        name: c.name?.trim() || `forum ${c.contextId.slice(0, 8)}`,
      })),
    [groupContexts],
  );

  // A desktop hand-off names the context to open; otherwise a persisted
  // selection, otherwise the first one this app owns.
  const [active, setActive] = useState<string | null>(
    () => callbackContextId ?? readActive(),
  );
  const userPicked = useRef(false);

  useEffect(() => {
    if (callbackContextId) {
      setActive(callbackContextId);
      return;
    }
    if (userPicked.current && active && contexts.some((c) => c.contextId === active)) {
      return;
    }
    // Drop a stale persisted id rather than keep pointing at a context that is
    // gone — that was the other route to a FunctionCallError.
    if (active && contexts.some((c) => c.contextId === active)) return;
    if (active) writeActive(null);
    setActive(contexts[0]?.contextId ?? null);
  }, [callbackContextId, contexts, active]);

  const select = useCallback((id: string) => {
    userPicked.current = true;
    setActive(id);
    writeActive(id);
  }, []);

  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const createForum = useCallback(
    async (name: string): Promise<string | null> => {
      if (!mero || !applicationId) {
        setCreateError("Connect a node first.");
        return null;
      }
      const trimmed = name.trim();
      if (!trimmed) {
        setCreateError("Give the forum a name.");
        return null;
      }
      setCreateLoading(true);
      setCreateError(null);
      try {
        // Reuse this app's namespace if it already has one, so a second forum
        // lands beside the first rather than in an unrelated namespace.
        let nsId = namespaceId;
        if (!nsId) {
          // No `upgradePolicy`: core stopped accepting it here and mero-js 13
          // dropped it from CreateNamespaceRequest.
          const ns = await mero.admin.createNamespace({
            applicationId,
            name: trimmed,
          });
          nsId = ns?.namespaceId ?? null;
          if (!nsId) throw new Error("createNamespace returned no namespaceId");
          try {
            await mero.admin.setDefaultCapabilities(nsId, {
              defaultCapabilities: DEFAULT_CAPABILITIES,
            });
          } catch {
            /* keep core's built-in default; the namespace works without this */
          }
        }

        // No `serviceName`: this app's bundle declares `services: null`, and
        // passing a name that is not in the bundle's list is one of the two
        // things that make this endpoint answer a bare 500.
        const ctx = await mero.admin.createContext({
          applicationId,
          groupId: nsId,
          initializationParams: [],
          name: trimmed,
        });
        const newId = ctx?.contextId;
        if (!newId) throw new Error("createContext returned no contextId");

        await refetchNamespaces();
        await refetchContexts();
        select(newId);
        return newId;
      } catch (err) {
        // Surfaced, not swallowed: a bare 500 from POST /contexts means the
        // contract's `init` rejected the params, and core hides untyped errors
        // deliberately. Hiding it again in the UI leaves nothing to debug.
        setCreateError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setCreateLoading(false);
      }
    },
    [mero, applicationId, namespaceId, refetchNamespaces, refetchContexts, select],
  );

  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const joinForum = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) {
        setJoinError("Paste the invitation you were sent.");
        return;
      }
      setJoinLoading(true);
      setJoinError(null);
      try {
        const parsed = JSON.parse(code) as {
          groupId?: string;
          invitation?: unknown;
          groupAlias?: string;
        };
        // ⚠️ The whole object is forwarded, never a re-typed subset: rc.29 made
        // `admitters` non-empty and a model that drops a signed field turns
        // every join into a refusal, silently.
        const nsId = parsed.groupId;
        const invitation = parsed.invitation ?? parsed;
        if (!nsId) throw new Error("that invitation names no namespace");
        await joinNamespace(nsId, {
          // Cast, NOT a re-typed object literal. The invitation is signed, and
          // rc.29 made `admitters` non-empty — a model that reconstructs the
          // payload field by field drops whatever it does not know about and
          // the node then refuses the join, with nothing in the response saying
          // which field went missing. Forward exactly what was pasted.
          invitation: invitation as Parameters<typeof joinNamespace>[1]["invitation"],
          groupName: parsed.groupAlias || undefined,
        });
        await refetchNamespaces();
        await refetchContexts();
      } catch (err) {
        setJoinError(err instanceof Error ? err.message : String(err));
      } finally {
        setJoinLoading(false);
      }
    },
    [joinNamespace, refetchNamespaces, refetchContexts],
  );

  const invite = useCallback(async () => {
    if (!namespaceId) throw new Error("No forum yet — create one first.");
    return createNamespaceInvitation(namespaceId, { recursive: true });
  }, [namespaceId, createNamespaceInvitation]);

  const loading = nsLoading || ctxLoading;

  return {
    applicationId: applicationId ?? null,
    contextId: active,
    namespaceId,
    loading,
    needsSetup: !loading && active === null,
    createForum,
    createLoading,
    createError,
    joinForum,
    joinLoading,
    joinError,
    invite,
    inviteLoading,
    select,
    contexts,
  };
}
