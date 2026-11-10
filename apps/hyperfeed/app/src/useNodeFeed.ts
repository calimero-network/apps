import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppInfo, CalimeroClient } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";
import { useInstanceRelease } from "@calimero-apps/passkey";
import { calimeroTransport, HyperfeedClient } from "./hyperfeed";
import type { LensView } from "./hyperfeedTypes";
import { clusterBackend, type FeedBackend } from "./backend";
import type { BlobStore } from "./attachments";
import { appKeyForPackage } from "./apps";
import { BUILT_IN, decodePayload, indexOf, toNotifications, type AppEvent, type RawEvent, type SourceContext } from "./collector";
import { parseLens, type LensHost, type LensSpec } from "./lens/lens";
import { clusterLensHosts } from "./lensHost";
import { isHyperfeed, otherApps } from "./otherApps";
import { signedIn } from "./newFeed";
import { useSessionApi } from "./session";

export interface NodeFeed {
  backend: FeedBackend | null;
  /** Bumped on every event of the feed itself. */
  nudge: number;
  /** The other apps being watched for notifications. */
  watching: SourceContext[];
  /**
   * The apps you reach, by app key, Hyperfeed itself left out; null until the
   * cluster says, or when it could not.
   */
  installed: string[] | null;
  /**
   * Install an app by its package. Not offered on a 1.0 cluster: packages are
   * installed by an organization's admins from the cluster's console.
   */
  install: ((pkg: string) => Promise<void>) | null;
  /** Why watching failed, when it did. The feed itself still works. */
  watchError: string | null;
  /** The last events each app version emitted, newest last: what a lens preview runs on. */
  recent: (appKey: string, applicationId: string) => (RawEvent & { contextId: string })[];
  /** A host to run a lens against one app instance, for a preview. */
  hostFor: (contextId: string) => LensHost | null;
}

/** Events kept per app version for a preview. */
const RECENT = 25;
/** How long to wait before following a stream again after it broke, at most. */
const MAX_BACKOFF_MS = 30_000;

/**
 * Follow `app`'s events from log index `from()`, again after any break (with
 * a backoff), until `signal` aborts.
 */
export async function follow(
  client: Pick<CalimeroClient, "events">,
  app: string,
  from: () => number,
  onEvent: (e: AppEvent) => void,
  signal: AbortSignal,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  let backoff = 1_000;
  while (!signal.aborted) {
    try {
      for await (const e of client.events(app, from(), signal)) {
        backoff = 1_000;
        onEvent(e);
      }
    } catch (e) {
      if (signal.aborted) return;
      console.warn(`[hyperfeed] the event stream of ${app} broke`, e);
    }
    if (signal.aborted) return;
    await sleep(backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

/** Where the collector is in each app's log, per account, kept across loads. */
function positionKey(account: string, app: string): string {
  return `hyperfeed:collector:${account}:${app}`;
}

function readPosition(account: string, app: string): number | null {
  try {
    const v = localStorage.getItem(positionKey(account, app));
    const n = v === null ? NaN : Number(v);
    return Number.isSafeInteger(n) ? n : null;
  } catch {
    return null;
  }
}

function writePosition(account: string, app: string, index: number) {
  try {
    localStorage.setItem(positionKey(account, app), String(index));
  } catch {
    // Private mode: it holds for this visit.
  }
}

/**
 * The log index `app` is at now: any view of its own that takes no argument
 * answers it. Watching starts after it, so the first visit records what
 * happens from now on, not the app's whole history. Null when it has no such view.
 */
export async function currentIndex(client: Pick<CalimeroClient, "appAbi" | "view">, app: string): Promise<number | null> {
  const abi = (await client.appAbi(app)) as { methods?: Record<string, { kind?: string; params?: unknown[] }> };
  const probe = Object.entries(abi.methods ?? {}).find(([, m]) => m.kind === "view" && (m.params ?? []).length === 0);
  if (!probe) return null;
  return (await client.view(app, probe[0], {})).index;
}

/**
 * The feed in app instance `appId`, plus the collector that fills it.
 *
 * The collector follows the events of every OTHER app this account reaches and
 * runs each event through the approved lens for that app's bundle (or the
 * lens this app ships), recording what it keeps as typed notifications. It
 * runs wherever the app is open; with two devices open, both record, and the
 * contract keeps one copy per event key.
 */
export function useNodeFeed(appId: string): NodeFeed {
  const { session } = useSessionApi();
  const live = signedIn(session);
  const client = live?.client ?? null;
  const account = live?.accountId ?? "";
  // A feed is an app instance, served the frontend of the release it runs.
  useInstanceRelease(client, appId);

  const backend = useMemo(() => {
    if (!client) return null;
    // Images are blobs of the feed's app: your other devices, and the agents
    // you let into the feed, read them by id.
    const images: BlobStore = {
      upload: async (data) => {
        const { blobId, size } = await client.uploadBlob(appId, new Uint8Array(await data.arrayBuffer()));
        return { blobId, size };
      },
      read: async (blobId) => new Blob([(await client.downloadBlob(appId, blobId)) as BlobPart]),
    };
    return clusterBackend(new HyperfeedClient(calimeroTransport(client), appId), otherApps(client), images);
  }, [client, appId]);
  const [nudge, setNudge] = useState(0);

  // The feed's own events: each one is a nudge to read the feed again. Live
  // only: what happened before is in the feed already.
  useEffect(() => {
    if (!client) return;
    const stop = new AbortController();
    let from: number | null = null;
    void (async () => {
      from = await client
        .view(appId, "settings", {})
        .then((v) => v.index + 1)
        .catch(() => 0);
      await follow(
        client,
        appId,
        () => from ?? 0,
        (e) => {
          const i = indexOf(e.id);
          if (i !== null) from = i + 1;
          setNudge((n) => n + 1);
        },
        stop.signal,
      );
    })();
    return () => stop.abort();
  }, [client, appId]);

  // Every app this account reaches.
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    let on = true;
    client.listApps().then(
      (all) => {
        if (!on) return;
        setApps(all);
        setAppsError(null);
      },
      (e: unknown) => {
        if (on) setAppsError(describeError(e));
      },
    );
    return () => {
      on = false;
    };
  }, [client]);

  const ownBundle = apps?.find((a) => a.appId === appId)?.bundle ?? null;
  const watching = useMemo<SourceContext[]>(
    () =>
      (apps ?? [])
        // Not the feed itself, and not another Hyperfeed: a feed of feeds
        // would record its own bookkeeping as news.
        .filter((a) => a.appId !== appId && !isHyperfeed(a, ownBundle, a.bundle))
        .map((a) => {
          const appKey = appKeyForPackage(a.package ?? undefined, a.bundle);
          return { contextId: a.appId, appKey, applicationId: a.bundle, label: `${appKey} · ${a.name || a.appId.slice(0, 6)}` };
        }),
    [apps, appId, ownBundle],
  );
  const orgs = useRef(new Map<string, string | null>());
  useEffect(() => {
    orgs.current = new Map((apps ?? []).map((a) => [a.appId, a.org]));
  }, [apps]);

  // The approved lenses, read again whenever the feed changes (a lens approved
  // on another device arrives as a feed event like anything else).
  const lenses = useRef(new Map<string, LensSpec>());
  useEffect(() => {
    if (!backend) return;
    let on = true;
    backend
      .lenses()
      .then((all: LensView[]) => {
        if (!on) return;
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
      on = false;
    };
  }, [backend, nudge]);

  const hosts = useMemo(
    () => (client ? clusterLensHosts(otherApps(client), client, account, (app) => orgs.current.get(app) ?? null) : null),
    [client, account],
  );

  const recentEvents = useRef(new Map<string, (RawEvent & { contextId: string })[]>());
  const [watchError, setWatchError] = useState<string | null>(null);

  const key = watching.map((w) => `${w.contextId}@${w.applicationId}`).join(",");
  useEffect(() => {
    if (!client || !backend || !hosts) return;
    const stop = new AbortController();
    for (const source of watching) {
      void (async () => {
        let from = readPosition(account, source.contextId);
        if (from === null) {
          const at = await currentIndex(client, source.contextId).catch((e: unknown) => {
            setWatchError(describeError(e));
            return null;
          });
          if (at === null) {
            console.warn(`[hyperfeed] not watching ${source.label}: it has no view to start from`);
            return;
          }
          from = at + 1;
          writePosition(account, source.contextId, from);
        }
        const lensKey = `${source.appKey}@${source.applicationId}`;
        await follow(
          client,
          source.contextId,
          () => from ?? 0,
          (event) => {
            const i = indexOf(event.id);
            if (i !== null) {
              from = i + 1;
              writePosition(account, source.contextId, from);
            }
            const kept = recentEvents.current.get(lensKey) ?? [];
            kept.push({ kind: event.kind, payload: decodePayload(event.data), at: Date.now(), contextId: source.contextId });
            recentEvents.current.set(lensKey, kept.slice(-RECENT));
            const lens = lenses.current.get(lensKey) ?? BUILT_IN[source.appKey] ?? null;
            // Fire and forget: a collector that stalls the stream waiting on
            // the cluster is worse than a missed notification. Never silently, though.
            void toNotifications(source, event, lens, hosts(source.contextId)).then((inputs) => {
              for (const input of inputs) {
                void backend
                  .recordNotification(input)
                  .catch((e: unknown) => console.warn("[hyperfeed] could not record a notification", input.key, e));
              }
            });
          },
          stop.signal,
        );
      })();
    }
    return () => stop.abort();
    // `key` stands for `watching`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, backend, hosts, account, key]);

  const installed = useMemo(() => (apps ? installedApps(apps, appId, ownBundle) : null), [apps, appId, ownBundle]);

  return {
    backend,
    nudge,
    watching,
    installed,
    install: null,
    watchError: appsError ?? watchError,
    recent: useCallback((appKey: string, bundle: string) => recentEvents.current.get(`${appKey}@${bundle}`) ?? [], []),
    hostFor: useCallback((app: string) => (hosts ? hosts(app) : null), [hosts]),
  };
}

/**
 * The app keys of the apps you reach, each once: not this Hyperfeed, nor
 * another one (a feed of feeds would record its own bookkeeping as news).
 */
export function installedApps(
  apps: Pick<AppInfo, "appId" | "package" | "bundle">[],
  self: string | null,
  ownBundle: string | null = null,
): string[] {
  const keys = new Set<string>();
  for (const a of apps) {
    if (a.appId === self || isHyperfeed(a, ownBundle, a.bundle)) continue;
    const key = appKeyForPackage(a.package ?? undefined, a.bundle);
    if (key !== "hyperfeed") keys.add(key);
  }
  return [...keys];
}
