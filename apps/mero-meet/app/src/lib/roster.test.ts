import { describe, expect, it } from "vitest";
import { GHOST_SILENCE_MS, partitionRoster } from "./roster";

const SELF = "self-id";
const NOW = 1_000_000;

function view(over: {
  roster: string[];
  lastAliveMs?: Array<[string, number]>;
  connected?: string[];
}) {
  return {
    roster: over.roster,
    selfId: SELF,
    nowMs: NOW,
    lastAliveMs: new Map(over.lastAliveMs ?? []),
    connected: new Set(over.connected ?? []),
  };
}

describe("partitionRoster (observed liveness)", () => {
  it("keeps self unconditionally", () => {
    const { live, ghosts } = partitionRoster(view({ roster: [SELF] }));
    expect(live).toEqual([SELF]);
    expect(ghosts).toEqual([]);
  });

  it("keeps a first-sighted peer (no observation yet — ghost clock starts now)", () => {
    const { live, ghosts } = partitionRoster(view({ roster: ["newcomer"] }));
    expect(live).toEqual(["newcomer"]);
    expect(ghosts).toEqual([]);
  });

  it("keeps a peer with a recent sign of life", () => {
    const { live } = partitionRoster(
      view({ roster: ["p"], lastAliveMs: [["p", NOW - GHOST_SILENCE_MS]] }), // exactly at limit
    );
    expect(live).toEqual(["p"]);
  });

  it("drops a peer silent past the limit", () => {
    const { live, ghosts } = partitionRoster(
      view({ roster: ["p"], lastAliveMs: [["p", NOW - GHOST_SILENCE_MS - 1]] }),
    );
    expect(live).toEqual([]);
    expect(ghosts).toEqual(["p"]);
  });

  it("CONNECTED media outranks silence — never ghost a peer we're streaming with", () => {
    const { live, ghosts } = partitionRoster(
      view({
        roster: ["p"],
        lastAliveMs: [["p", NOW - GHOST_SILENCE_MS * 10]], // very silent
        connected: ["p"],
      }),
    );
    expect(live).toEqual(["p"]);
    expect(ghosts).toEqual([]);
  });

  it("partitions a mixed roster", () => {
    const { live, ghosts } = partitionRoster(
      view({
        roster: [SELF, "fresh", "dead", "streaming", "unknown"],
        lastAliveMs: [
          ["fresh", NOW - 5_000],
          ["dead", NOW - GHOST_SILENCE_MS * 2],
          ["streaming", NOW - GHOST_SILENCE_MS * 2],
        ],
        connected: ["streaming"],
      }),
    );
    expect(live).toEqual([SELF, "fresh", "streaming", "unknown"]);
    expect(ghosts).toEqual(["dead"]);
  });
});
