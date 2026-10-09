import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useContexts, useMero, useSubscription } from "@calimero-network/mero-react";
import type { SubscriptionEventData } from "@calimero-network/mero-react";
import { HyperfeedClient } from "./generated/HyperfeedClient";
import { nodeBackend, type FeedBackend } from "./backend";
import { appKeyForPackage } from "./apps";
import { identitiesOf, toNotifications, type SourceContext, type SourceReader, type StateMutation } from "./collector";

export interface NodeFeed {
  backend: FeedBackend | null;
  /** Bumped on every event for the feed's own context. */
  nudge: number;
  /** The other contexts being watched for notifications. */
  watching: SourceContext[];
  /** Why watching failed, when it did. The feed itself still works. */
  watchError: string | null;
}

/**
 * The feed in `contextId`, plus the collector that fills it.
 *
 * The collector subscribes to every OTHER context on the node and records what
 * their apps emit as notifications in the feed. It runs wherever the app is
 * open; with two devices open, both record, and the contract keeps one copy
 * per event key.
 */
export function useNodeFeed(contextId: string): NodeFeed {
  const { mero, admin, applicationId } = useMero();
  const backend = useMemo(() => (mero ? nodeBackend(new HyperfeedClient(mero, contextId)) : null), [mero, contextId]);
  const [nudge, setNudge] = useState(0);

  // Every context on the node. With no application id, `useContexts` asks the
  // node for all of them, which is exactly what a collector wants.
  const { contexts, error: contextsError } = useContexts(null);
  const [packages, setPackages] = useState<Record<string, string | undefined>>({});
  const [packagesError, setPackagesError] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    let live = true;
    admin
      .listApplications()
      .then((res) => {
        if (!live) return;
        const byId: Record<string, string | undefined> = {};
        for (const app of res.apps) byId[app.id] = app.package;
        setPackages(byId);
      })
      .catch((e: unknown) => {
        if (live) setPackagesError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [admin]);

  const watching = useMemo<SourceContext[]>(
    () =>
      contexts
        // Not the feed itself, and not another Hyperfeed context: a feed of
        // feeds would record its own bookkeeping as news.
        .filter((c) => c.contextId !== contextId && c.applicationId !== applicationId)
        .map((c) => {
          const appKey = appKeyForPackage(packages[c.applicationId], c.applicationId);
          return { contextId: c.contextId, appKey, label: `${appKey} · ${c.contextId.slice(0, 6)}` };
        }),
    [contexts, contextId, applicationId, packages],
  );
  const sources = useRef(new Map<string, SourceContext>());
  // The last root seen per context: half of each notification's key.
  const lastRoots = useRef(new Map<string, string>());
  sources.current = new Map(watching.map((s) => [s.contextId, s]));

  // How the collector reads what an event points at. Who you are is the
  // node's account (and this device), the same in every context: asked once.
  const self = useRef<Promise<Set<string>> | null>(null);
  const readerFor = useCallback(
    (sourceContext: string): SourceReader | null => {
      if (!mero || !admin) return null;
      return {
        call: <T,>(method: string, args: Record<string, unknown>) =>
          mero.rpc.execute<T>({ contextId: sourceContext, method, argsJson: args }),
        me: () => {
          if (!self.current) {
            const asked = admin.getNodeIdentity().then((id) => identitiesOf([id.accountId, id.deviceId]));
            // A failed lookup is asked again next time, not remembered.
            asked.catch(() => {
              self.current = null;
            });
            self.current = asked;
          }
          return self.current;
        },
      };
    },
    [mero, admin],
  );

  const ids = useMemo(() => [contextId, ...watching.map((w) => w.contextId)], [contextId, watching]);

  useSubscription(
    ids,
    useCallback(
      (event: SubscriptionEventData) => {
        if (!("contextId" in event)) return;
        if (event.contextId === contextId) {
          setNudge((n) => n + 1);
          return;
        }
        const source = sources.current.get(event.contextId);
        if (!source || !backend) return;
        if (event.type && event.type !== "StateMutation") return;
        const mutation = event.data as StateMutation;
        const previous = lastRoots.current.get(event.contextId) ?? "";
        if (mutation?.newRoot) lastRoots.current.set(event.contextId, mutation.newRoot);
        const reader = readerFor(event.contextId);
        if (!reader) return;
        // Fire and forget: a collector that stalls the stream waiting on the
        // node is worse than a missed notification. Never silently, though.
        void toNotifications(source, mutation, previous, reader).then((inputs) => {
          for (const input of inputs) {
            void backend
              .recordNotification(input)
              .catch((e: unknown) => console.warn("[hyperfeed] could not record a notification", input.key, e));
          }
        });
      },
      [contextId, backend, readerFor],
    ),
  );

  return {
    backend,
    nudge,
    watching,
    watchError: contextsError?.message ?? packagesError,
  };
}
