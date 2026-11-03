import { createContext, useContext } from "react";
import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";

/** A scene opened in the studio: an instance of this app (v1's context). */
export type OpenedScene = Pick<AppInfo, "appId" | "name" | "org">;

/**
 * What the studio needs from outside it: the signed-in client and the scene it
 * has open. v1 read all of this from mero-react's `useMero()`.
 */
export interface SceneSession extends OpenedScene {
  /** The signed-in client; every request of the open scene goes through it. */
  client: CalimeroClient;
  /** The caller's account id, what the contract answers as `me`. */
  accountId: string;
  /** Runs after each request: keeps the stored session current. */
  after: () => void;
  /** A passkey for step-ups (minting an invitation). */
  passkey: () => PasskeyProvider;
  /** Back to the scene list. */
  leave: () => void;
  /** End the session. */
  logout: () => void;
}

export const SceneContext = createContext<SceneSession | null>(null);

/** The open scene. Only rendered inside a `SceneContext.Provider`. */
export function useScene(): SceneSession {
  const scene = useContext(SceneContext);
  if (!scene) throw new Error("useScene() outside an open scene");
  return scene;
}

/** The open scene, or null outside one (tests that render a panel alone). */
export function useMaybeScene(): SceneSession | null {
  return useContext(SceneContext);
}
