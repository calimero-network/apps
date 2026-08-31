// Fixture data for the screenshot harness. See ../shots.mjs.
import type { LiveStats } from "../../src/types";
import type { ProbeSnapshot } from "../../src/lib/metrics";
import { MAX_BROADCASTERS, evaluateSlots } from "../../src/lib/slots";

/** Names shown on the tiles. Real-ish, so the labels look like a real call. */
export const PEER_NAMES: Record<string, string> = {
  peer1: "Ana",
  peer2: "Marek",
  peer3: "Priya",
  peer4: "Tomas",
  me: "You",
};

export const PROBE: ProbeSnapshot = {
  sendFps: 24.98,
  renderFps: 24.91,
  encodedBytesPerSec: 191_488,
  rawBytesPerSec: 7_680_000,
  compressionRatio: 40.1,
  encodeMsP50: 7,
  encodeMsP95: 14,
  latencyMsP50: 63,
  latencyMsP95: 118,
  latencyMsMax: 204,
  seqGaps: 0,
  encodeErrors: 0,
  frameSamples: 512,
  framesRenderedTotal: 7431,
};

/**
 * All zeroes, and that is the measurement rather than a placeholder: media rides
 * ephemeral presence, so nothing reaches replicated state.
 */
export const STATS: LiveStats = {
  liveChunks: 0,
  liveBytes: 0,
  prunedChunks: 0,
  senders: [],
};

export interface Scenario {
  id: string;
  title: string;
  /** Which screen to render. Defaults to the call. */
  page?: "call" | "streams" | "rooms";
  /** Open the invite sheet on a list page. */
  invite?: boolean;
  /** Remote broadcasters, in claim order. */
  remotes: string[];
  running: boolean;
  yielded?: boolean;
  error?: string | null;
  dialog?: "data" | "people";
  theme?: "dark" | "light";
  /** Room members, including spectators who are not broadcasting. */
  members: number;
}

const NOW = 1_700_000_000_000;

export const SCENARIOS: Scenario[] = [
  {
    id: "idle",
    title: "Joined, nobody broadcasting yet",
    remotes: [],
    running: false,
    members: 3,
  },
  {
    id: "solo",
    title: "One broadcaster (you)",
    remotes: [],
    running: true,
    members: 3,
  },
  {
    id: "two",
    title: "Two broadcasters",
    remotes: ["peer1"],
    running: true,
    members: 4,
  },
  {
    id: "slots-full",
    title: `All ${MAX_BROADCASTERS} slots in use, you hold one`,
    remotes: Array.from(
      { length: MAX_BROADCASTERS - 1 },
      (_, i) => `peer${i + 1}`,
    ),
    running: true,
    members: 7,
  },
  {
    id: "spectator",
    title: "Slots full — you are a spectator",
    remotes: Array.from(
      { length: MAX_BROADCASTERS },
      (_, i) => `peer${i + 1}`,
    ),
    running: false,
    members: 9,
  },
  {
    id: "yielded",
    title: "You lost the race for the last slot",
    remotes: Array.from(
      { length: MAX_BROADCASTERS },
      (_, i) => `peer${i + 1}`,
    ),
    running: false,
    yielded: true,
    members: 9,
  },
  {
    id: "dialog",
    title: "See more data",
    remotes: Array.from(
      { length: MAX_BROADCASTERS - 1 },
      (_, i) => `peer${i + 1}`,
    ),
    running: true,
    dialog: "data",
    members: 7,
  },
  {
    id: "light",
    title: "Light theme",
    remotes: ["peer1"],
    running: true,
    theme: "light",
    members: 5,
  },
  {
    id: "people",
    title: "Your nickname, and who is here",
    remotes: ["peer1"],
    running: true,
    members: 6,
    dialog: "people",
  },
  {
    id: "streams",
    title: "Your streams",
    page: "streams",
    remotes: [],
    running: false,
    members: 1,
  },
  {
    id: "streams-empty",
    title: "No streams yet",
    page: "streams",
    remotes: [],
    running: false,
    members: 1,
  },
  {
    id: "invite",
    title: "An invitation: link, QR, and the code as a fallback",
    page: "streams",
    invite: true,
    remotes: [],
    running: false,
    members: 1,
  },
  {
    id: "rooms",
    title: "Rooms inside one stream",
    page: "rooms",
    remotes: [],
    running: false,
    members: 1,
  },
];

/** The slot view a client in this scenario would compute. */
export function slotsFor(sc: Scenario) {
  return evaluateSlots({
    others: sc.remotes.map((id, i) => ({
      id,
      startedAtMs: NOW + i,
      lastSeenAt: NOW + 100,
    })),
    me: "me",
    // Later than every remote, so "four" puts us in the last slot and
    // "spectator" leaves us out — which is what those scenarios are showing.
    myStartedAtMs: sc.running ? NOW + 50 : null,
    nowMs: NOW + 100,
    timeoutMs: 6000,
  });
}

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

/**
 * The probe as this scenario would actually read.
 *
 * Zeroed when nothing is being received, because a screenshot of an idle call
 * showing "24.9/s decode" documents a state the app cannot be in — and these
 * images are read as documentation.
 */
export function probeFor(sc: Scenario): ProbeSnapshot {
  if (sc.remotes.length > 0) return PROBE;
  return {
    ...PROBE,
    renderFps: 0,
    encodedBytesPerSec: sc.running ? PROBE.encodedBytesPerSec : 0,
    rawBytesPerSec: sc.running ? PROBE.rawBytesPerSec : 0,
    sendFps: sc.running ? PROBE.sendFps : 0,
    compressionRatio: sc.running ? PROBE.compressionRatio : null,
    // No frame from anyone else means no latency sample: latency is measured
    // across two machines, and our own preview never leaves this one.
    latencyMsP50: null,
    latencyMsP95: null,
    latencyMsMax: null,
    encodeMsP50: sc.running ? PROBE.encodeMsP50 : null,
    encodeMsP95: sc.running ? PROBE.encodeMsP95 : null,
    frameSamples: 0,
    framesRenderedTotal: 0,
  };
}
