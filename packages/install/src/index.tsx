import { useSyncExternalStore, type ReactNode } from "react";
import { isServedByNode } from "@calimero-apps/node-served";

/**
 * Register the app's service worker (`installableApp` in vite.config). Not in
 * dev: every app runs on localhost:5173 there, so one app's worker would take
 * over the next. Not on a node either: a node serves every release of an app
 * from one origin, and a worker there could hand one release another's files.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV || isServedByNode(new URL(window.location.href))) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Chrome and Edge fire `beforeinstallprompt` once, early, often before React
// has mounted, so it is captured when this module loads and handed out here.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while the browser offers installing this app (Chrome, Edge; never once installed). */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false,
  );
}

/** Opens the browser's install dialog. */
export async function promptInstall(): Promise<void> {
  const event = deferred;
  if (!event) return;
  deferred = null;
  notify();
  await event.prompt();
}

/** A button that installs the app; renders nothing unless the browser offers it. */
export function InstallAppButton({ className, children }: { className?: string; children: ReactNode }) {
  const canInstall = useCanInstall();
  if (!canInstall) return null;
  return (
    <button type="button" className={className} onClick={() => void promptInstall()} data-testid="install-app">
      {children}
    </button>
  );
}
