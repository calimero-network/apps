import { useState, useEffect } from "react";
import { downloadBlob } from "../api/meroJsClient";
import { getOrgRecord, invalidate, memberAvatar, type MemberAvatar } from "../api/platform";
import { getGroupId } from "../constants/config";
import { toAccountHex } from "../utils/accountIdentity";

// A person's picture lives beside their name: the workspace's member metadata
// (`avatar: { blob, app }`), keyed by account. The blob is held by one
// conversation every member reaches (#general where there is one), so the
// same picture shows in every channel and DM.

// blob → object URL
const blobUrlCache = new Map<string, string>();
const blobFetchInFlight = new Map<string, Promise<string | undefined>>();

const cacheVersionListeners = new Set<() => void>();

/** `account`'s picture in workspace `org`, if they set one. */
export async function avatarOf(org: string, account: string): Promise<MemberAvatar | undefined> {
  if (!org || !account) return undefined;
  const record = await getOrgRecord(org).catch(() => null);
  return record ? memberAvatar(record, toAccountHex(account)) : undefined;
}

async function resolveBlob({ blob, app }: MemberAvatar): Promise<string | undefined> {
  const key = `${app}:${blob}`;
  if (blobUrlCache.has(key)) return blobUrlCache.get(key);
  if (blobFetchInFlight.has(key)) return blobFetchInFlight.get(key)!;

  const p = downloadBlob(blob, app)
    .then((bytes) => {
      const url = URL.createObjectURL(bytes);
      blobUrlCache.set(key, url);
      return url;
    })
    .catch((err): undefined => {
      console.error(`[useAvatarUrl] downloadBlob failed for ${blob}`, err);
      return undefined;
    })
    .finally(() => blobFetchInFlight.delete(key));

  blobFetchInFlight.set(key, p);
  return p;
}

/** The image URL of `account`'s picture, once loaded; undefined while loading or when none is set. */
export function useAvatarUrl(account: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    cacheVersionListeners.add(bump);
    return () => {
      cacheVersionListeners.delete(bump);
    };
  }, []);

  useEffect(() => {
    const org = getGroupId();
    if (!account || !org) return;
    let cancelled = false;
    setUrl(undefined);

    void (async () => {
      const avatar = await avatarOf(org, account);
      if (cancelled) return;
      if (!avatar) {
        setUrl(undefined);
        return;
      }
      const resolved = await resolveBlob(avatar);
      if (!cancelled) setUrl(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [account, version]);

  return url;
}

/** Forget every loaded picture so mounted avatars re-read. Call after changing yours. */
export function invalidateAvatarCache() {
  invalidate(getGroupId() || undefined);
  blobUrlCache.forEach((url) => URL.revokeObjectURL(url));
  blobUrlCache.clear();
  cacheVersionListeners.forEach((fn) => fn());
}
