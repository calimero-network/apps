import { useCallback, useEffect, useState } from "react";
import { nodeBasename } from "@calimero-apps/node-served";

/** The router base: `/{version}/` when a node serves the app, else `/`. */
export const BASE = nodeBasename(new URL(window.location.href), "/");

export type Route = { page: "meetings" } | { page: "actions" } | { page: "meeting"; id: string };

const APP_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The workspace a link names: `#/w/<appId>` or `#/w/<appId>/m/<id>`, as the
 * extension links to a meeting it recorded. `null` when the link names none.
 */
export function linkedWorkspace(hash: string): string | null {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return parts[0] === "w" && parts[1] && APP_ID.test(parts[1]) ? parts[1] : null;
}

/** `#/m/<id>`, `#/actions`, anything else the meetings list; a `#/w/<appId>` prefix is skipped. */
export function parseRoute(hash: string): Route {
  let parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "w") parts = parts.slice(2);
  if (parts[0] === "actions") return { page: "actions" };
  if (parts[0] === "m" && parts[1] && /^[0-9a-f]{1,64}$/.test(parts[1])) return { page: "meeting", id: parts[1] };
  return { page: "meetings" };
}

export function routeHash(route: Route): string {
  if (route.page === "actions") return "#/actions";
  if (route.page === "meeting") return `#/m/${route.id}`;
  return "#/";
}

/** Where the app is, in the URL hash: a reload or a shared link lands on the same meeting. */
export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((r: Route) => {
    const hash = routeHash(r);
    if (window.location.hash !== hash) window.location.hash = hash;
    setRoute(r);
  }, []);
  return [route, go];
}
