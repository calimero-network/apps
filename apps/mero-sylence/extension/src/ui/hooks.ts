import { useEffect, useState } from "react";
import { detectCaps } from "../lib/caps";
import type { OffscreenEvent } from "../lib/messages";
import type { Capabilities } from "../lib/tiers";
import { watch, type Area } from "../lib/storage";

/** A `chrome.storage` value, live. `undefined` until the first read. */
export function useStored<T>(area: Area, key: string): T | null | undefined {
  const [value, setValue] = useState<T | null | undefined>(undefined);
  useEffect(() => watch<T>(area, key, setValue), [area, key]);
  return value;
}

/** The two input levels while recording, 0–1. */
export function useLevels(): { you: number; others: number } {
  const [levels, setLevels] = useState({ you: 0, others: 0 });
  useEffect(() => {
    const listener = (m: unknown) => {
      const e = m as Partial<OffscreenEvent>;
      if (e.source === "offscreen" && e.type === "levels") {
        const l = m as Extract<OffscreenEvent, { type: "levels" }>;
        setLevels({ you: l.you, others: l.others });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  return levels;
}

export interface ActiveTab {
  id: number;
  url: string;
  title: string;
}

export function useActiveTab(): ActiveTab | null | undefined {
  const [tab, setTab] = useState<ActiveTab | null | undefined>(undefined);
  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      setTab(t?.id !== undefined ? { id: t.id, url: t.url ?? "", title: t.title ?? "" } : null);
    });
  }, []);
  return tab;
}

/** Seconds since `since`, ticking. */
export function useElapsed(since: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [since]);
  return since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
}

export function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** What this laptop can run, read again whenever `refresh` changes (a model finished downloading). */
export function useCaps(refresh: unknown = null): Capabilities | null {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    void detectCaps().then(setCaps);
  }, [refresh]);
  return caps;
}

/** This laptop, as the speech models see it: "8 GB+ memory · 10 cores · graphics chip". */
export function describeCaps(caps: Capabilities): string {
  const parts: string[] = [];
  if (caps.deviceMemoryGb) parts.push(`${caps.deviceMemoryGb >= 8 ? "8 GB+" : `${caps.deviceMemoryGb} GB`} memory`);
  if (caps.cores) parts.push(`${caps.cores} cores`);
  parts.push(caps.webgpu ? "graphics chip" : "no graphics acceleration");
  if (caps.chromeOS) parts.push("Chromebook");
  return parts.join(" · ");
}

/** Whether the extension may use the microphone (granted once on the permission page). */
export function useMicAllowed(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let status: PermissionStatus | null = null;
    if (!navigator.permissions?.query) return;
    void navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((s) => {
        status = s;
        setAllowed(s.state === "granted");
        s.onchange = () => setAllowed(s.state === "granted");
      })
      .catch(() => setAllowed(null));
    return () => {
      if (status) status.onchange = null;
    };
  }, []);
  return allowed;
}
