// mero-react with the node-facing parts swapped out. The storage helpers
// (getContextId, setContextIdentity, ...) stay REAL — they are plain
// localStorage and the app relies on their exact keys. Only the provider, the
// session hook and the live channels (SSE, ephemeral presence) are replaced.
import { useMemo, type ReactNode } from "react";

import { fakeMero } from "./fakeMero";
import { CONTEXTS, P } from "./world";

import { CalimeroLogo } from "../../node_modules/@calimero-network/mero-react/dist/index.js";

export * from "../../node_modules/@calimero-network/mero-react/dist/index.js";

export const AppMode = { MultiContext: "MultiContext", SingleContext: "SingleContext" } as const;

export function MeroProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

type Scene = { unauthenticated?: boolean; typingIn?: string; typingName?: string; online?: string[] };
const scene: Scene = (globalThis as { __SHOT_SCENE__?: Scene }).__SHOT_SCENE__ ?? {};

export function useMero() {
  const authed = !scene.unauthenticated;
  return {
    mero: authed ? fakeMero : null,
    isAuthenticated: authed,
    isLoading: false,
    nodeUrl: "http://node.mock",
    connectToNode: () => {},
    logout: () => {},
  };
}
export const useCalimero = useMero;

export function getNodeUrl() {
  return "http://node.mock";
}

export function ConnectButton() {
  return (
    // The markup mero-react's own ConnectButton renders when not connected.
    <div className="mero-connect-container" style={{ position: "relative", display: "inline-block" }}>
      <button className="mero-connect-button" aria-label="Connect">
        <CalimeroLogo size={18} className="mero-logo" />
        Connect
      </button>
    </div>
  );
}

export function useSubscription() {
  /* no live node — events never arrive */
}

const peersByContext = new Map<string, Map<string, unknown>>();
const EMPTY = new Map<string, unknown>();
const noop = () => {};

export function useEphemeral<T>(contextId: string | null) {
  const peers = useMemo(() => {
    if (!contextId) return EMPTY;
    let map = peersByContext.get(contextId);
    if (!map) {
      map = new Map();
      if (scene.typingIn && contextId === CONTEXTS.find((c) => c.key === scene.typingIn)?.contextId) {
        map.set("peer-typing", { name: scene.typingName ?? P.theo.name, typing: true });
      }
      for (const name of scene.online ?? []) map.set(`peer-${name}`, { name, typing: false });
      peersByContext.set(contextId, map);
    }
    return map;
  }, [contextId]) as Map<string, T>;
  return { peers, setPresence: noop, ageOf: () => 0, error: null };
}
