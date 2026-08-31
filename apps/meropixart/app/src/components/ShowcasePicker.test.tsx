import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { SHOWCASE_PROJECTS } from "../showcase";

// Rendering a showcase poster is the single most expensive thing the app does on
// the main thread — 85-160ms each at full resolution. The gallery shows four of
// them, so the ONLY thing keeping it responsive is that they render one per
// frame. Four `requestAnimationFrame` callbacks registered in the same tick all
// fire in the SAME frame, which is exactly the bug this guards: the naive
// per-card rAF looks like staggering and isn't.

vi.mock("../showcase/preview", () => ({
  renderShowcaseThumb: vi.fn(() => {
    rendered.push("x");
    return { toDataURL: () => "data:image/png;base64,AAAA" };
  }),
}));

let rendered: string[] = [];
/** Queued rAF callbacks, drained one frame at a time. */
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  rendered = [];
  frames = [];
  // The picker keeps a module-level poster cache and render queue, so each test
  // needs its own copy of the module or the second test finds every card cached.
  vi.resetModules();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Run exactly one frame's worth of callbacks. */
function tick(): void {
  const due = frames;
  frames = [];
  act(() => { due.forEach((cb) => cb(0)); });
}

async function open() {
  const { default: ShowcasePicker } = await import("./ShowcasePicker");
  return render(
    <ShowcasePicker hasContent={false} onPick={vi.fn()} onClose={vi.fn()} />,
  );
}

describe("ShowcasePicker thumbnails", () => {
  it("renders at most one poster per frame", async () => {
    await open();
    // The modal itself is up before any poster has been rendered.
    expect(screen.getByTestId("showcase-picker")).toBeTruthy();
    expect(rendered).toHaveLength(0);

    for (let i = 1; i <= SHOWCASE_PROJECTS.length; i++) {
      tick();
      expect(rendered, `after frame ${i}`).toHaveLength(i);
    }
  });

  it("eventually renders every card", async () => {
    await open();
    for (let i = 0; i < SHOWCASE_PROJECTS.length + 2; i++) tick();
    expect(rendered).toHaveLength(SHOWCASE_PROJECTS.length);
  });

  it("does not keep rendering posters for a gallery that was closed", async () => {
    const { unmount } = await open();
    tick();               // first card renders
    expect(rendered).toHaveLength(1);
    act(() => { unmount(); });
    for (let i = 0; i < SHOWCASE_PROJECTS.length + 2; i++) tick();
    // The queued cards are dropped rather than burning frames on a closed modal.
    expect(rendered).toHaveLength(1);
  });
});
