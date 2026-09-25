import { useEffect, useRef } from "react";
import type { ContextUnread } from "./useUnreadCounts";

/**
 * Mirror the total unread-message count onto every "app icon" surface available:
 *
 *  1. Native Badging API — `navigator.setAppBadge`. In the Calimero desktop
 *     launcher the shell polyfills this to a native per-app dock badge; in an
 *     INSTALLED PWA it hits the real OS badge. In a plain browser tab it's a
 *     no-op (there's no app icon to badge), which is why we also do 2 + 3.
 *  2. Document title — `(3) Mero Chat`. Shows in the browser tab / window title.
 *  3. Favicon — the tab icon is redrawn with a red count bubble (the Gmail/Slack
 *     "unread dot on the tab" trick), the only per-tab icon badge browsers allow.
 *
 * All three are driven off the same total and only touched when it changes.
 */
export function useAppBadge(unreadCounts: Map<string, ContextUnread>): void {
  const lastTotal = useRef<number>(-1);

  useEffect(() => {
    let total = 0;
    for (const c of unreadCounts.values()) total += c.messages || 0;

    if (total === lastTotal.current) return;
    lastTotal.current = total;

    // 1. Native badge (launcher / installed PWA). No-op in a plain tab.
    try {
      if (total > 0) navigator.setAppBadge?.(total);
      else navigator.clearAppBadge?.();
    } catch {
      /* Badging API unsupported — ignore */
    }

    // 2 + 3. In-tab fallbacks.
    updateTitle(total);
    updateFavicon(total);
  }, [unreadCounts]);
}

/** "99+" caps the label so it fits the badge and the title. */
function badgeLabel(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/**
 * Prefix the tab title with `(n) `. Re-derives the base each time by stripping
 * our own prefix, so it composes with any title the app sets elsewhere and never
 * stacks `(1) (2) …`.
 */
function updateTitle(total: number): void {
  if (typeof document === "undefined") return;
  const base = document.title.replace(/^\(\d+\+?\)\s*/, "");
  document.title = total > 0 ? `(${badgeLabel(total)}) ${base}` : base;
}

// Original favicon href, captured once so we can restore it at zero unread.
let baseFaviconHref: string | null = null;

function faviconLink(): HTMLLinkElement | null {
  if (typeof document === "undefined") return null;
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  return link;
}

/**
 * Redraw the favicon with a red count bubble in the corner. At zero unread the
 * original favicon is restored. Draws over the existing icon when it loads,
 * otherwise falls back to just the bubble (e.g. an SVG that won't rasterize).
 */
function updateFavicon(total: number): void {
  const link = faviconLink();
  if (!link) return;
  if (baseFaviconHref === null) baseFaviconHref = link.getAttribute("href") || "";

  if (total <= 0) {
    if (baseFaviconHref) link.href = baseFaviconHref;
    return;
  }

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const drawBubble = () => {
    const r = size * 0.32;
    const cx = size - r - 2;
    const cy = size - r - 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#e01e5a";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(r * 1.15)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badgeLabel(total), cx, cy + 1);
    link.href = canvas.toDataURL("image/png");
  };

  if (baseFaviconHref) {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      drawBubble();
    };
    img.onerror = drawBubble;
    img.src = baseFaviconHref;
  } else {
    drawBubble();
  }
}
