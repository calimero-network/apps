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

// The header button's look: the fleet's glass tokens, so it sits beside any
// app's own top-bar icons. Injected once, so an app needs no stylesheet import.
const ICON_BUTTON_CSS = `
.cal-install-icon{border:none;background:transparent;color:var(--glass-ink-2,#3c4256);width:36px;height:36px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;padding:0;transition:color .2s ease,background-color .2s ease}
.cal-install-icon:hover{color:var(--glass-ink,#14182b);background-color:color-mix(in srgb,var(--glass-ink,#14182b) 10%,transparent)}
.cal-install-icon:focus-visible{outline:2px solid var(--glass-accent,#3451d1);outline-offset:2px}
`;
let iconCssInjected = false;
function injectIconCss() {
  if (iconCssInjected || typeof document === "undefined") return;
  iconCssInjected = true;
  const style = document.createElement("style");
  style.dataset.calInstall = "";
  style.textContent = ICON_BUTTON_CSS;
  document.head.appendChild(style);
}

/** Monitor with a download arrow: the install icon every app's header uses. */
export function InstallIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4M12 6v7M9 10l3 3 3-3" />
    </svg>
  );
}

/**
 * The in-app header button: a round icon button that installs the app, hidden
 * unless the browser offers it. `className` replaces the default look.
 */
export function InstallAppIconButton({ className, size }: { className?: string; size?: number }) {
  const canInstall = useCanInstall();
  if (!canInstall) return null;
  if (!className) injectIconCss();
  return (
    <button
      type="button"
      className={className ?? "cal-install-icon"}
      onClick={() => void promptInstall()}
      aria-label="Install app"
      title="Install app"
      data-testid="install-app"
    >
      <InstallIcon size={size} />
    </button>
  );
}
