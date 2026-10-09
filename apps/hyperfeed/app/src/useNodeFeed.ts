import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useContexts, useMero, useSubscription } from "@calimero-network/mero-react";
import type { SubscriptionEventData } from "@calimero-network/mero-react";
import { HyperfeedClient, type LensView } from "./generated/HyperfeedClient";
import { nodeBackend, type FeedBackend } from "./backend";
import { appKeyForPackage } from "./apps";
import { BUILT_IN, decodePayload, toNotifications, type RawEvent, type SourceContext, type StateMutation } from "./collector";
import { parseLens, type LensHost, type LensSpec } from "./lens/lens";
import { nodeLensHosts, type NodeAdmin } from "./nodeHost";

export interface NodeFeed {
  backend: FeedBackend | null;
  /** Bumped on every event for the feed's own context. */
  nudge: number;
  /** The other contexts being watched for notifications. */
  watching: SourceContext[];
  /** Why watching failed, when it did. The feed itself still works. */
  watchError: string | null;
  /** The last events each app version emitted, newest last: what a lens preview runs on. */
  recent: (appKey: string, applicationId: string) => (RawEvent & { contextId: string })[];
  /** A host to run a lens against one context, for a preview. */
  hostFor: (contextId: string) => LensHost | null;
}

/** Events kept per app version for a preview. */
const RECENT = 25;

/**
 * The feed in `contextId`, plus the collector that fills it.
 *
 * The collector subscribes to every OTHER context on the node and runs each
 * event through the approved lens for that context's app version (or the lens
 * this app ships, for Chat), recording what it keeps as typed notifications.
 * It runs wherever the app is open; with two devices open, both record, and
 * the contract keeps one copy per event key.
 */
export function useNodeFeed(contextId: string): NodeFeed {
  const { mero, admin, applicationId } = useMero();
  const backend = useMemo(
    () => (mero ? nodeBackend(new HyperfeedClient(mero, contextId), mero.rpc) : null),
    [mero, contextId],
  );
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
          return {
            contextId: c.contextId,
            appKey,
            applicationId: c.applicationId,
            label: `${appKey} · ${c.contextId.slice(0, 6)}`,
          };
        }),
    [contexts, contextId, applicationId, packages],
  );
  const sources = useRef(new Map<string, SourceContext>());
  // The last root seen per context: half of each notification's key.
  const lastRoots = useRef(new Map<string, string>());
  sources.current = new Map(watching.map((s) => [s.contextId, s]));

  // The approved lenses, re-read whenever the feed changes (a lens approved on
  // another device arrives as a feed event like anything else).
  const lenses = useRef(new Map<string, LensSpec>());
  useEffect(() => {
    if (!backend) return;
    let live = true;
    backend
      .lenses()
      .then((all: LensView[]) => {
        if (!live) return;
        const approved = new Map<string, LensSpec>();
        for (const l of all) {
          if (l.status !== "approved") continue;
          try {
            approved.set(`${l.app}@${l.application_id}`, parseLens(l.spec));
          } catch (e) {
            console.warn("[hyperfeed] an approved lens does not parse", l.app, e);
          }
        }
        lenses.current = approved;
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [backend, nudge]);
  const lensFor = (source: SourceContext): LensSpec | null =>
    lenses.current.get(`${source.appKey}@${source.applicationId}`) ?? BUILT_IN[source.appKey] ?? null;

  const hosts = useMemo(
    () => (mero && admin ? nodeLensHosts(mero.rpc, admin as unknown as NodeAdmin) : null),
    [mero, admin],
  );

  const recentEvents = useRef(new Map<string, (RawEvent & { contextId: string })[]>());

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
        if (!source || !backend || !hosts) return;
        if (event.type && event.type !== "StateMutation") return;
        const mutation = event.data as StateMutation;
        const previous = lastRoots.current.get(event.contextId) ?? "";
        if (mutation?.newRoot) lastRoots.current.set(event.contextId, mutation.newRoot);
        const key = `${source.appKey}@${source.applicationId}`;
        const kept = recentEvents.current.get(key) ?? [];
        for (const e of mutation?.events ?? []) {
          if (e.kind) kept.push({ kind: e.kind, payload: decodePayload(e.data), at: Date.now(), contextId: source.contextId });
        }
        recentEvents.current.set(key, kept.slice(-RECENT));
        // Fire and forget: a collector that stalls the stream waiting on the
        // node is worse than a missed notification. Never silently, though.
        void toNotifications(source, mutation, previous, lensFor(source), hosts(event.contextId)).then((inputs) => {
          for (const input of inputs) {
            void backend
              .recordNotification(input)
              .catch((e: unknown) => console.warn("[hyperfeed] could not record a notification", input.key, e));
          }
        });
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [contextId, backend, hosts],
    ),
  );

  return {
    backend,
    nudge,
    watching,
    watchError: contextsError?.message ?? packagesError,
    recent: useCallback((appKey: string, appId: string) => recentEvents.current.get(`${appKey}@${appId}`) ?? [], []),
    hostFor: useCallback((ctx: string) => (hosts ? hosts(ctx) : null), [hosts]),
  };
}
