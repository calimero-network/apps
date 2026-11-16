// The consent pop-up the node sends back to the app must not boot a game.

import { afterEach, describe, expect, it, vi } from "vitest";

import { startUnlessConsentReturn } from "../src/ui/createWorld";

const wait = () => new Promise((r) => setTimeout(r, 20));

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  document.body.innerHTML = "";
});

describe("startUnlessConsentReturn", () => {
  it("starts the game on a normal page load", async () => {
    const start = vi.fn();
    startUnlessConsentReturn(start);
    await wait();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("tells the opener and closes, without starting, in the pop-up the node sent back", async () => {
    const opener = { location: { origin: window.location.origin }, postMessage: vi.fn() };
    vi.stubGlobal("opener", opener);
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    window.history.replaceState(null, "", "/?request_id=r1&result=approved");
    const start = vi.fn();
    startUnlessConsentReturn(start);
    await wait();
    expect(start).not.toHaveBeenCalled();
    expect(opener.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: "r1", result: "approved" }), window.location.origin);
    expect(close).toHaveBeenCalled();
  });
});
