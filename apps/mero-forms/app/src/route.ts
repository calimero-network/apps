import { useCallback, useEffect, useState } from "react";

export type FormTab = "responses" | "edit" | "preview" | "connect";
export const FORM_TABS: FormTab[] = ["responses", "edit", "preview", "connect"];

export type Route = { page: "forms" } | { page: "team" } | { page: "form"; id: string; tab: FormTab };

/** `#/form/<id>/<tab>`, `#/team`, anything else the forms list. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "team") return { page: "team" };
  if (parts[0] === "form" && parts[1] && /^[0-9a-f]{1,64}$/.test(parts[1])) {
    const tab = FORM_TABS.find((t) => t === parts[2]) ?? "responses";
    return { page: "form", id: parts[1], tab };
  }
  return { page: "forms" };
}

export function routeHash(route: Route): string {
  if (route.page === "team") return "#/team";
  if (route.page === "form") return `#/form/${route.id}/${route.tab}`;
  return "#/";
}

/**
 * Where the app is, in the URL hash, so a reload or a shared link lands on
 * the same form and tab. The hash only: the query string belongs to the login
 * callback and invitation capture.
 */
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
