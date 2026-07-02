import { describe, expect, it } from "vitest";
import { GHOST_STALE_SECS, partitionRoster } from "./roster";
import type { Presence } from "../types";

const SELF = "self-id";
const NOW = 10_000;

function presenceOf(entries: Array<[string, number]>): Map<string, Presence> {
  return new Map(
    entries.map(([memberId, updatedAt]) => [
      memberId,
      {
        memberId,
        username: memberId,
        status: "in_call",
        muted: false,
        videoOn: true,
        callId: "c1",
        joinedAt: 0,
        updatedAt,
      },
    ]),
  );
}

describe("partitionRoster", () => {
  it("keeps self even with no/stale presence", () => {
    const { live, ghosts } = partitionRoster([SELF], new Map(), SELF, NOW);
    expect(live).toEqual([SELF]);
    expect(ghosts).toEqual([]);
  });

  it("keeps a peer whose presence has not gossiped in yet (joining, not a ghost)", () => {
    const { live, ghosts } = partitionRoster(["newcomer"], new Map(), SELF, NOW);
    expect(live).toEqual(["newcomer"]);
    expect(ghosts).toEqual([]);
  });

  it("keeps a peer with a fresh heartbeat", () => {
    const presence = presenceOf([["peer", NOW - GHOST_STALE_SECS]]); // exactly at limit
    const { live, ghosts } = partitionRoster(["peer"], presence, SELF, NOW);
    expect(live).toEqual(["peer"]);
    expect(ghosts).toEqual([]);
  });

  it("drops a peer with positive evidence of death (stale presence row)", () => {
    const presence = presenceOf([["ghost", NOW - GHOST_STALE_SECS - 1]]);
    const { live, ghosts } = partitionRoster(["ghost"], presence, SELF, NOW);
    expect(live).toEqual([]);
    expect(ghosts).toEqual(["ghost"]);
  });

  it("partitions a mixed roster correctly", () => {
    const presence = presenceOf([
      ["fresh", NOW - 5],
      ["dead", NOW - 500],
    ]);
    const { live, ghosts } = partitionRoster(
      [SELF, "fresh", "dead", "unknown"],
      presence,
      SELF,
      NOW,
    );
    expect(live).toEqual([SELF, "fresh", "unknown"]);
    expect(ghosts).toEqual(["dead"]);
  });
});
