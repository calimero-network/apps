import { useState, useEffect } from "react";
import { getContextId, getContextIdentity } from "@calimero-network/mero-react";
import { getMeroJs, downloadBlob } from "../api/meroJsClient";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";

// ── Module-level caches ───────────────────────────────────────────────────────

type ProfileRow = { identity: string; avatar?: string };

// Unified cache + in-flight dedup: once the promise resolves it stays here so
// future awaits return the already-resolved value immediately.
const profilesForCtx = new Map<string, Promise<ProfileRow[]>>();

// blob ID → object URL
const blobUrlCache = new Map<string, string>();
const blobFetchInFlight = new Map<string, Promise<string | undefined>>();

const cacheVersionListeners = new Set<() => void>();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveExecutorKey(contextId: string): Promise<string> {
  // Use the active context's identity directly — no extra RPC needed.
  if (contextId === (getContextId() ?? "")) {
    return getContextIdentity() ?? "";
  }
  // For other contexts (e.g. DM contexts), look up the owned identity.
  try {
    const owned = await getMeroJs().admin.getContextIdentitiesOwned(contextId);
    return (owned as { identities?: string[] }).identities?.[0] ?? "";
  } catch {
    return getContextIdentity() ?? "";
  }
}

function getProfilesForCtx(contextId: string): Promise<ProfileRow[]> {
  if (profilesForCtx.has(contextId)) return profilesForCtx.get(contextId)!;

  const p = resolveExecutorKey(contextId).then((executorKey) => {
    if (!executorKey) return [] as ProfileRow[];
    return new ClientApiDataSource()
      .getProfiles(contextId, executorKey)
      .then((res) => (res.data ?? []) as ProfileRow[])
      .catch((err) => {
        console.error("[useAvatarUrl] getProfiles failed", err);
        profilesForCtx.delete(contextId);
        return [] as ProfileRow[];
      });
  });

  profilesForCtx.set(contextId, p);
  return p;
}

async function resolveBlob(blobId: string, contextId: string): Promise<string | undefined> {
  if (blobUrlCache.has(blobId)) return blobUrlCache.get(blobId);
  if (blobFetchInFlight.has(blobId)) return blobFetchInFlight.get(blobId)!;

  const p = downloadBlob(blobId, contextId)
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      blobUrlCache.set(blobId, url);
      return url;
    })
    .catch((err): undefined => {
      console.error(`[useAvatarUrl] downloadBlob failed for ${blobId}`, err);
      return undefined;
    })
    .finally(() => blobFetchInFlight.delete(blobId));

  blobFetchInFlight.set(blobId, p);
  return p;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/** Async-loads the avatar image URL for an identity within a context.
 *  Returns undefined while loading or when no avatar is set. */
export function useAvatarUrl(
  identity: string | undefined,
  contextId: string | undefined,
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [version, setVersion] = useState(0);

  // Subscribe to cache invalidation so we re-fetch after avatar updates.
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    cacheVersionListeners.add(bump);
    return () => { cacheVersionListeners.delete(bump); };
  }, []);

  useEffect(() => {
    if (!identity || !contextId) return;
    let cancelled = false;

    // Clear immediately so a revoked/stale URL doesn't linger while we re-fetch.
    // Avatar falls back to initials during the async window.
    setUrl(undefined);

    (async () => {
      const profiles = await getProfilesForCtx(contextId);
      if (cancelled) return;

      const avatarBlobId = profiles.find((p) => p.identity === identity)?.avatar;
      if (!avatarBlobId) {
        setUrl(undefined);
        return;
      }

      const resolved = await resolveBlob(avatarBlobId, contextId);
      if (!cancelled) setUrl(resolved);
    })();

    return () => { cancelled = true; };
  }, [identity, contextId, version]);

  return url;
}

// ── Cache control ─────────────────────────────────────────────────────────────

/** Clear all profile + blob caches and force every mounted hook to re-fetch.
 *  Call immediately after the user updates their avatar. */
export function invalidateAvatarCache() {
  profilesForCtx.clear();
  blobUrlCache.forEach((url) => URL.revokeObjectURL(url));
  blobUrlCache.clear();
  cacheVersionListeners.forEach((fn) => fn());
}
