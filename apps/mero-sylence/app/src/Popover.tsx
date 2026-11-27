import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A dropdown drawn over the page, beside `anchor`: never clipped by the card
 * it opens from. Below the anchor, or above it when there is no room; lined
 * up with its left edge, or its right edge near the screen's right. It
 * follows the anchor on scroll and resize. Clicks inside it count as inside
 * for whoever closes it on an outside click (`[data-popover]`).
 */
export function Popover({
  anchor,
  closing = false,
  className = "",
  width,
  children,
  label,
  role = "dialog",
}: {
  anchor: HTMLElement | null;
  closing?: boolean;
  className?: string;
  width: number;
  children: ReactNode;
  label?: string;
  role?: string;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const room = vh - r.bottom;
      const up = room < 280 && r.top > room;
      const left = Math.max(8, Math.min(r.left, vw - width - 8));
      setPos({ top: up ? r.top - 6 : r.bottom + 6, left, up });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, width]);
  if (!anchor || !pos) return null;
  return createPortal(
    <div
      data-popover=""
      role={role}
      aria-label={label}
      className={`popover ${pos.up ? "up" : "down"}${closing ? " closing" : ""} ${className}`}
      style={{ position: "fixed", top: pos.top, left: pos.left, width, transform: pos.up ? "translateY(-100%)" : undefined }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Whether a click landed inside an open popover (so an outside-click handler leaves it be). */
export function inPopover(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-popover]") !== null;
}
