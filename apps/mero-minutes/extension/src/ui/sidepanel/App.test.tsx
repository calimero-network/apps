import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { IDLE, KEYS } from "../../lib/messages";
import { write } from "../../lib/storage";
import { installFakeChrome } from "../../test/fakeChrome";
import { App } from "./App";

beforeEach(() => {
  installFakeChrome();
  Element.prototype.scrollIntoView = () => undefined;
});

describe("side panel", () => {
  it("shows the transcript as it grows, grouped by speaker", async () => {
    await write("session", KEYS.status, { ...IDLE, phase: "recording", meeting: { id: "m", appId: "a", title: "Sync", platform: "meet", startedAt: 0 } });
    render(<App />);
    expect(await screen.findByText(/Listening/)).toBeTruthy();
    await act(() =>
      write("session", KEYS.transcript, [
        { speaker: "others", text: "Hello", startMs: 0 },
        { speaker: "others", text: "everyone.", startMs: 2_000 },
        { speaker: "you", text: "Hi!", startMs: 4_000 },
      ]),
    );
    expect(await screen.findByText("Hello everyone.")).toBeTruthy();
    expect(screen.getByText("Hi!")).toBeTruthy();
    expect(screen.getByText("Sync")).toBeTruthy();
  });
});
