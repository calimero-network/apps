/**
 * The bridge between the native shell and the game page, as data.
 *
 * Kept free of the DOM so it reads as the protocol it is. The native twins are
 * `KombatCore/Bridge.swift` (iOS) and `app/bridge/Bridge.kt` (Android); all
 * three encode the same messages, and the native unit tests pin the wire form.
 *
 * Page → native (one JSON string per message, posted to the platform's handler):
 *   {"v":1,"op":"ready"}
 *   {"v":1,"op":"query"|"execute","id":7,"method":"act","args":{…}}
 *   {"v":1,"op":"presence","slice":{…}}
 *   {"v":1,"op":"over","over":true}
 *
 * Native → page (`window.meroGame.receive(<message>)`):
 *   {"t":"boot","mode":"net"|"cpu"|"spectate","local":0|1|null,"fighters":["kinetic","cryo"],"muted":false}
 *   {"t":"state","view":<ArenaView>}            the contract's latest read
 *   {"t":"slice","slice":<Slice>}               the opponent's presence
 *   {"t":"press","b":"punch","d":true}          the fight pad
 *   {"t":"result","id":7,"ok":true,"value":…}   a query/execute answered
 *   {"t":"result","id":7,"ok":false,"error":"…"}
 *   {"t":"pause"} | {"t":"resume"} | {"t":"restart"} | {"t":"mute","on":true}
 */
import type { Slice } from "../../../app/src/game/controller";
import type { FighterId } from "../../../app/src/game/fighters";
import type { Button } from "../../../app/src/game/input";
import type { Mode } from "../../../app/src/game/controller";

export const PROTOCOL_VERSION = 1;

export type ToNative =
  | { v: 1; op: "ready" }
  | { v: 1; op: "query" | "execute"; id: number; method: string; args: unknown }
  | { v: 1; op: "presence"; slice: Slice }
  | { v: 1; op: "over"; over: boolean };

/** The contract's ArenaView as the generated clients serialise it (snake_case, as in the ABI). */
export interface ArenaViewWire {
  title: string;
  match_index: number;
  round: number;
  status: string;
  round_results: string[];
  winner: string;
  flawless: boolean;
  p1: FighterWire;
  p2: FighterWire;
  me: string;
  my_seat: string;
  hits: { by: string; id: number }[];
}

export interface FighterWire {
  seat: string;
  member: string;
  name: string;
  fighter: string;
  online: boolean;
  hp: number;
  rounds_won: number;
}

export type ToPage =
  | { t: "boot"; mode: Mode; local: 0 | 1 | null; fighters: [FighterId, FighterId]; muted?: boolean }
  | { t: "state"; view: ArenaViewWire }
  | { t: "slice"; slice: Slice }
  | { t: "press"; b: Button; d: boolean }
  | { t: "result"; id: number; ok: true; value: unknown }
  | { t: "result"; id: number; ok: false; error: string }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "restart" }
  | { t: "mute"; on: boolean };

const BUTTONS: readonly Button[] = ["left", "right", "up", "down", "punch", "kick", "block", "special"];

export function isButton(b: unknown): b is Button {
  return typeof b === "string" && (BUTTONS as readonly string[]).includes(b);
}
