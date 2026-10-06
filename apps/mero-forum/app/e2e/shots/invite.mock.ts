// Aliased over @calimero-apps/invite by vite.config.ts. Only the "invitation"
// scenario delivers a captured link, so the app-level prompt can be photographed.
import { scenarioById } from "./fixtures";

export type CapturedInvitation = { token: string; resolve: () => void };

export function onInvitation(cb: (c: CapturedInvitation) => void) {
  const id = new URLSearchParams(location.search).get("s") ?? "feed";
  if (scenarioById(id).id !== "invitation") return () => {};
  const t = setTimeout(
    () => cb({ token: "shots-token", resolve: () => {} }),
    50,
  );
  return () => clearTimeout(t);
}

export function shouldRetain() {
  return false;
}
