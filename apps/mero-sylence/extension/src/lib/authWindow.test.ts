import { describe, expect, it, vi } from "vitest";
import { AUTH_WINDOW, centred, focusAuthWindow, openAuthWindow, type AuthWindowDeps } from "./authWindow";

const CB = "https://ljpjgindjakdpmbpjdcpadihhnaemocf.chromiumapp.org/";

function fake() {
  const updated: Array<(id: number, c: { url?: string }, t?: { windowId?: number }) => void> = [];
  const removed: Array<(id: number) => void> = [];
  const deps = {
    tabs: { onUpdated: { addListener: (l: never) => updated.push(l), removeListener: (l: never) => updated.splice(updated.indexOf(l), 1) } },
    windows: {
      getLastFocused: vi.fn(async () => ({ left: 100, top: 50, width: 1460, height: 900 })),
      create: vi.fn(async () => ({ id: 7, tabs: [{ id: 70 }] })),
      remove: vi.fn(async () => undefined),
      onRemoved: { addListener: (l: never) => removed.push(l), removeListener: (l: never) => removed.splice(removed.indexOf(l), 1) },
    },
  };
  return { deps: deps as unknown as AuthWindowDeps, raw: deps, updated, removed };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("sign-in window", () => {
  it("opens a small popup window centred over the browser, not full screen", async () => {
    const f = fake();
    void openAuthWindow("http://localhost:5173/#native-sign-in", CB, f.deps);
    await tick();
    expect(f.raw.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "popup", width: AUTH_WINDOW.width, height: AUTH_WINDOW.height, left: 600, top: 140 }),
    );
  });

  it("resolves with the callback URL and closes the window", async () => {
    const f = fake();
    const answer = openAuthWindow("http://x/", CB, f.deps);
    await tick();
    f.updated.forEach((l) => l(70, { url: "http://x/#native-sign-in" }));
    f.updated.forEach((l) => l(99, { url: `${CB}signed-in#state=other` }));
    f.updated.forEach((l) => l(70, { url: `${CB}signed-in#state=s&box=b` }));
    expect(await answer).toBe(`${CB}signed-in#state=s&box=b`);
    expect(f.raw.windows.remove).toHaveBeenCalledWith(7);
    expect(f.updated).toHaveLength(0);
    expect(f.removed).toHaveLength(0);
  });

  it("resolves null when the person closes the window", async () => {
    const f = fake();
    const answer = openAuthWindow("http://x/", CB, f.deps);
    await tick();
    f.removed.forEach((l) => l(3));
    f.removed.forEach((l) => l(7));
    expect(await answer).toBeNull();
    expect(f.raw.windows.remove).not.toHaveBeenCalled();
  });

  it("centres only when the browser window's size is known", () => {
    expect(centred(undefined)).toEqual({});
    expect(centred({ left: 0, top: 0, width: 300, height: 300 })).toEqual({ left: 0, top: 0 });
  });

  it("brings the open window forward, and has none to bring once it closed", async () => {
    const f = fake();
    const update = vi.fn(async () => undefined);
    const answer = openAuthWindow("http://x/", CB, f.deps);
    await tick();
    expect(await focusAuthWindow({ update } as never)).toBe(true);
    expect(update).toHaveBeenCalledWith(7, expect.objectContaining({ focused: true }));
    f.removed.forEach((l) => l(7));
    await answer;
    expect(await focusAuthWindow({ update } as never)).toBe(false);
  });
});
