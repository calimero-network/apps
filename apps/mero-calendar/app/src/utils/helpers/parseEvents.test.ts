import { describe, it, expect } from "vitest";
import parseEvents from "./parseEvents";
import type { IEventJsonRpc } from "../../api/clientApi";

const base: IEventJsonRpc = {
  id: "e1",
  title: "Standup",
  description: "",
  start: "2026-07-01T09:00:00",
  end: "2026-07-01T09:30:00",
  peers: [],
  event_type: "event",
  color: "rgb(51, 182, 121)",
  owner: "pkOwner",
};

describe("parseEvents (peers round-trip bugfix)", () => {
  it("keeps a multi-peer list as a real string[] — never collapses to one", () => {
    const [event] = parseEvents([{ ...base, peers: ["pkAlice", "pkBob", "pkCarol"] }]);
    // The old bug joined with ',' then split on ', ', merging peers into one.
    expect(event.peers).toEqual(["pkAlice", "pkBob", "pkCarol"]);
    expect(event.peers).toHaveLength(3);
  });

  it("maps event_type → type and defaults missing peers to []", () => {
    const [event] = parseEvents([{ ...base, peers: undefined as unknown as string[] }]);
    expect(event.type).toBe("event");
    expect(event.peers).toEqual([]);
  });

  it("carries the private flag through (defaults to false)", () => {
    const [shared] = parseEvents([{ ...base }]);
    const [priv] = parseEvents([{ ...base, private: true }]);
    expect(shared.private).toBe(false);
    expect(priv.private).toBe(true);
  });
});
