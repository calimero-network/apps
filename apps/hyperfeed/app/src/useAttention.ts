import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FeedPage } from "./generated/HyperfeedClient";
import { appLook } from "./apps";
import { newAlerts, tabTitle, waitingKeys, type Alert } from "./attention";

const ALERTS_KEY = "hyperfeed:alerts";
const appName = (key: string) => appLook(key).name;

/** Alerts as you set them in this browser, and what the system lets this page do. */
export interface Attention {
  /** The system can show banners here at all. */
  supported: boolean;
  /** On, and the system allows it. */
  on: boolean;
  /** You turned them on, but the system (or you, in its settings) blocks them. */
  blocked: boolean;
  /** Turn alerts on (asking the system first, from your click) or off. */
  toggle: () => Promise<void>;
}

/**
 * Tell you when something starts needing you while you look elsewhere: a
 * system banner per new thing, and the waiting count in the tab's title
 * (always, alerts on or off). A banner only when the page is hidden or out of
 * focus: in front of you, the feed itself shows it.
 */
export function useAttention(page: FeedPage | null, base: string, total?: number): Attention {
  const navigate = useNavigate();
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [wanted, setWanted] = useState(() => {
    try {
      return localStorage.getItem(ALERTS_KEY) === "on";
    } catch {
      return false;
    }
  });
  const [permission, setPermission] = useState<NotificationPermission>(() => (supported ? Notification.permission : "denied"));
  const on = supported && wanted && permission === "granted";

  // The title the page loaded with, so the count goes in front of it and away again.
  const baseTitle = useRef(typeof document !== "undefined" ? document.title : "hyperfeed");
  // Everything the bell counts, Settings included, when the caller knows it.
  const waiting = total ?? page?.counts.needs_you ?? 0;
  useEffect(() => {
    document.title = tabTitle(waiting, baseTitle.current);
  }, [waiting]);
  useEffect(() => () => void (document.title = baseTitle.current), []);

  const seen = useRef<Set<string> | null>(null);
  const seenCount = useRef<number | null>(null);
  useEffect(() => {
    if (!page) return;
    const alerts = newAlerts(seen.current, page.items, appName);
    // A filter can hide what started needing you, and a lens or rule waits in Settings: the count still rose.
    if (alerts.length === 0 && seenCount.current != null && waiting > seenCount.current) {
      alerts.push({ chain: "", title: "Something needs you", body: "Open Hyperfeed to see it.", opens: "feed" });
    }
    seen.current = waitingKeys(page.items);
    seenCount.current = waiting;
    if (!on || alerts.length === 0) return;
    if (document.visibilityState === "visible" && document.hasFocus()) return;
    for (const a of alerts) show(a, (to) => navigate(to), base);
  }, [page, waiting, on, base, navigate]);

  const toggle = useCallback(async () => {
    if (!supported) return;
    const next = !wanted;
    let granted = Notification.permission;
    if (next && granted === "default") granted = await Notification.requestPermission();
    setPermission(granted);
    setWanted(next);
    try {
      localStorage.setItem(ALERTS_KEY, next ? "on" : "off");
    } catch {
      // Private mode: it holds for this visit.
    }
  }, [supported, wanted]);

  return { supported, on, blocked: supported && wanted && permission === "denied", toggle };
}

function show(a: Alert, go: (to: string) => void, base: string) {
  const to = a.opens === "chat" && a.chain ? `${base}/chat/${encodeURIComponent(a.chain)}` : base || "/";
  const options = { body: a.body, tag: a.chain || "hyperfeed", icon: "/icon-192.png" };
  try {
    const n = new Notification(a.title, options);
    n.onclick = () => {
      window.focus();
      go(to);
      n.close();
    };
  } catch {
    // Android's Chrome (and a Home Screen app on iOS) shows banners only from
    // a service worker: hand it to Hyperfeed's, whose click opens `data.url`.
    void viaWorker(a.title, { ...options, data: { url: to } });
  }
}

async function viaWorker(title: string, options: NotificationOptions): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
    await reg.showNotification(title, options);
  } catch {
    // No worker either: the tab's title and the bell still count what waits.
  }
}
