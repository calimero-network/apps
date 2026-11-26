/**
 * Just enough of `chrome.*` for the screens and storage helpers: two storage
 * areas with change events, runtime messaging answered by a test handler,
 * tabs and the side panel recorded.
 */
import { vi } from "vitest";

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
type MessageListener = (message: unknown, sender: unknown, respond: (r: unknown) => void) => boolean | void;

export interface FakeChrome {
  areas: Record<"local" | "session", Map<string, unknown>>;
  /** Answers `chrome.runtime.sendMessage`; the default says ok with null. */
  onSend: (message: unknown) => unknown;
  sent: unknown[];
  created: string[];
  panels: number[];
  activeTab: { id: number; url: string; title: string } | null;
  /** Delivers a message to the page's `runtime.onMessage` listeners (as the offscreen page would). */
  broadcast(message: unknown): void;
}

export function installFakeChrome(): FakeChrome {
  const storageListeners = new Set<Listener>();
  const messageListeners = new Set<MessageListener>();
  const fake: FakeChrome = {
    areas: { local: new Map(), session: new Map() },
    onSend: () => ({ ok: true, value: null }),
    sent: [],
    created: [],
    panels: [],
    activeTab: null,
    broadcast(message) {
      for (const l of messageListeners) l(message, {}, () => undefined);
    },
  };

  const area = (name: "local" | "session") => {
    const map = fake.areas[name];
    const notify = (changes: Record<string, chrome.storage.StorageChange>) => {
      for (const l of storageListeners) l(changes, name);
    };
    return {
      get: vi.fn(async (key: string) => (map.has(key) ? { [key]: structuredClone(map.get(key)) } : {})),
      set: vi.fn(async (items: Record<string, unknown>) => {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: map.get(k), newValue: structuredClone(v) };
          map.set(k, structuredClone(v));
        }
        notify(changes);
      }),
      remove: vi.fn(async (key: string) => {
        const old = map.get(key);
        map.delete(key);
        notify({ [key]: { oldValue: old } });
      }),
    };
  };

  const chromeLike = {
    storage: {
      local: area("local"),
      session: area("session"),
      onChanged: {
        addListener: (l: Listener) => storageListeners.add(l),
        removeListener: (l: Listener) => storageListeners.delete(l),
      },
    },
    runtime: {
      id: "test",
      getURL: (p: string) => `chrome-extension://test/${p}`,
      sendMessage: vi.fn(async (message: unknown) => {
        fake.sent.push(message);
        return fake.onSend(message);
      }),
      onMessage: {
        addListener: (l: MessageListener) => messageListeners.add(l),
        removeListener: (l: MessageListener) => messageListeners.delete(l),
      },
    },
    tabs: {
      query: vi.fn(async () => (fake.activeTab ? [fake.activeTab] : [])),
      create: vi.fn(async ({ url }: { url: string }) => {
        fake.created.push(url);
        return { id: 99, url };
      }),
    },
    sidePanel: {
      open: vi.fn(async ({ tabId }: { tabId: number }) => {
        fake.panels.push(tabId);
      }),
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeLike;
  return fake;
}
