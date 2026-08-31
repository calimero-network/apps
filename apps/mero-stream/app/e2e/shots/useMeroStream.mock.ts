// Aliased over ../../src/hooks/useMeroStream by vite.config.ts. See ../shots.mjs.
import { useMemo } from "react";
import type { Member } from "../../src/types";
import { PEER_NAMES, scenarioById } from "./fixtures";

const scenarioId = new URLSearchParams(location.search).get("s") ?? "idle";

export function useMeroStream() {
  return useMemo(() => {
    const sc = scenarioById(scenarioId);
    const members: Member[] = [
      { memberId: "me", username: "You", joinedAt: 0, updatedAt: 0 },
      ...sc.remotes.map((id) => ({
        memberId: id,
        username: PEER_NAMES[id] ?? id,
        joinedAt: 0,
        updatedAt: 0,
      })),
      // Spectators: in the room, holding no slot. They are what makes the
      // participant count in the top bar exceed the number of tiles.
      ...Array.from(
        { length: Math.max(0, sc.members - sc.remotes.length - 1) },
        (_, i) => ({
          memberId: `watcher${i}`,
          username: `watcher-${i + 1}`,
          joinedAt: 0,
          updatedAt: 0,
        }),
      ),
    ];
    return {
      contextId: "7Hs2Qk9vLxTnR4mZbA1cWpYeUf3gJd6NqSvXhKrM8tBz",
      executorId: "me",
      loading: false,
      error: null,
      join: async () => members[0],
      getMembers: async () => members,
      encodeFrame: async () => 0,
      getFrame: async () => [],
      pruneFrames: async () => undefined,
      getStats: async () => null,
      renameStream: async () => undefined,
      postChunk: async () => 0,
      getChunks: async () => [],
      keyframeCursors: async () => [],
      getLiveStats: async () => null,
    };
  }, []);
}
