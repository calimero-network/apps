import { useEffect, useState } from "react";
import { resolveSource, type AppSource } from "@calimero-apps/connect";

type SourceClient = Parameters<typeof resolveSource>[0];

/**
 * The release new instances are created from (`resolveSource` in `@calimero-apps/connect`), read once per
 * account's session: `source` is `base` until the read lands, then `base` at the newest release the node lists.
 * `pending` is true only for a package with no version, while signed in and reading; a raw bundle or a named
 * version is final at once. A new client or account reads again. `base` may be a fresh object each render.
 */
export function useResolvedSource(client: SourceClient | null, accountId: string | null, base: AppSource): { source: AppSource; pending: boolean } {
  const key = typeof base === "string" ? base : `${base.package}@${base.version ?? ""}`;
  const [resolved, setResolved] = useState<{ client: SourceClient; accountId: string; key: string; source: AppSource } | null>(null);
  useEffect(() => {
    if (!client || !accountId) return;
    let live = true;
    void resolveSource(client, base, window.location.href).then((source) => live && setResolved({ client, accountId, key, source }));
    return () => {
      live = false;
    };
    // `key` stands for `base`: a fresh object each render is the same source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, accountId, key]);
  const current = resolved?.client === client && resolved?.accountId === accountId && resolved?.key === key ? resolved.source : undefined;
  const unversioned = typeof base !== "string" && !base.version;
  return { source: current ?? base, pending: unversioned && client !== null && accountId !== null && current === undefined };
}
