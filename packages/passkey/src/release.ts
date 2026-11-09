import { useEffect, useState } from "react";
import { followInstanceRelease, type FollowReleaseOptions, type ReleaseClient } from "@calimero-apps/connect";

/**
 * Serves the instance being entered the frontend of the release it runs
 * (`followInstanceRelease` in `@calimero-apps/connect`): once per client and
 * instance, a page of another release moves to `/app/{app}/` with its route
 * and query. `true` while it is leaving, so the app may hold the instance's
 * view back rather than talk to a backend of another release. Nothing in
 * development, and never a loop.
 */
export function useInstanceRelease(
  client: ReleaseClient | null | undefined,
  app: string | null | undefined,
  options: Pick<FollowReleaseOptions, "href" | "storage" | "navigate"> = {},
): boolean {
  const [leaving, setLeaving] = useState(false);
  const { href, storage, navigate } = options;
  useEffect(() => {
    setLeaving(false);
    if (!client || !app) return;
    let live = true;
    void followInstanceRelease({
      client,
      app,
      ...(href !== undefined ? { href } : {}),
      ...(storage !== undefined ? { storage } : {}),
      ...(navigate ? { navigate } : {}),
    }).then((moved) => {
      if (live && moved) setLeaving(true);
    });
    return () => {
      live = false;
    };
  }, [client, app, href, storage, navigate]);
  return leaving;
}
