/**
 * The sign-in window: a small popup window (not `launchWebAuthFlow`, which
 * some browsers open full screen) on the served page. When the page sends the
 * browser to the extension's callback (`https://<id>.chromiumapp.org/…`), the
 * window is closed and that URL, fragment and all, is the answer.
 */

export const AUTH_WINDOW = { width: 460, height: 720 } as const;

/**
 * Creating a workspace: a session bound to Sylence's page may not create an
 * organization by itself, so the node asks for the passkey on its own page.
 * The page opens that in a small window of its own only when it is wider than
 * 640 px (mero-react's `useNodeConsent`); in a narrower one it would have to
 * leave the page for it. This window is wide enough.
 */
export const CREATE_WINDOW = { width: 720, height: 760 } as const;

type Tabs = Pick<typeof chrome.tabs, "onUpdated">;
type Windows = Pick<typeof chrome.windows, "create" | "remove" | "onRemoved" | "getLastFocused"> &
  Partial<Pick<typeof chrome.windows, "update">>;

/** The sign-in window open now, if any: a second sign-in brings it forward instead of opening another. */
let openWindowId: number | null = null;

/** Brings the open sign-in window to the front; false when none is open. */
export async function focusAuthWindow(windows: Pick<typeof chrome.windows, "update"> = chrome.windows): Promise<boolean> {
  if (openWindowId === null) return false;
  try {
    await windows.update(openWindowId, { focused: true, drawAttention: true });
    return true;
  } catch {
    // Closed under us: there is none to bring forward.
    openWindowId = null;
    return false;
  }
}

export interface AuthWindowDeps {
  tabs: Tabs;
  windows: Windows;
}

/** Where a window of `size` sits centred over `around`. */
export function centred(
  around: { left?: number; top?: number; width?: number; height?: number } | undefined,
  size: { width: number; height: number } = AUTH_WINDOW,
): { left?: number; top?: number } {
  if (!around || around.width === undefined || around.height === undefined) return {};
  return {
    left: Math.max(0, Math.round((around.left ?? 0) + (around.width - size.width) / 2)),
    top: Math.max(0, Math.round((around.top ?? 0) + (around.height - size.height) / 2)),
  };
}

/** Opens `url` in a popup window; resolves with the callback URL, or `null` if the person closed it. */
export async function openAuthWindow(
  url: string,
  callbackPrefix: string,
  deps: AuthWindowDeps = { tabs: chrome.tabs, windows: chrome.windows },
  size: { width: number; height: number } = AUTH_WINDOW,
): Promise<string | null> {
  const last = await deps.windows.getLastFocused().catch(() => undefined);
  const win = await deps.windows.create({ url, type: "popup", focused: true, ...size, ...centred(last, size) });
  const windowId = win?.id;
  const tabId = win?.tabs?.[0]?.id;
  if (windowId === undefined) throw new Error("Could not open the sign-in window.");
  openWindowId = windowId;

  return new Promise<string | null>((resolve) => {
    let done = false;
    const finish = (answer: string | null) => {
      if (done) return;
      done = true;
      if (openWindowId === windowId) openWindowId = null;
      deps.tabs.onUpdated.removeListener(onUpdated);
      deps.windows.onRemoved.removeListener(onRemoved);
      if (answer !== null) void deps.windows.remove(windowId).catch(() => undefined);
      resolve(answer);
    };
    const onUpdated = (id: number, change: { url?: string }, tab?: { windowId?: number; url?: string }) => {
      const inWindow = tabId !== undefined ? id === tabId : tab?.windowId === windowId;
      const at = change.url ?? tab?.url;
      if (inWindow && at && at.startsWith(callbackPrefix)) finish(at);
    };
    const onRemoved = (id: number) => {
      if (id === windowId) finish(null);
    };
    deps.tabs.onUpdated.addListener(onUpdated);
    deps.windows.onRemoved.addListener(onRemoved);
  });
}
