/**
 * The roster. A fighter is a look and a special move — damage is defined once,
 * in the contract, and is the same for everybody.
 *
 * Must match `FIGHTERS` in logic/src/lib.rs: the contract refuses any other id.
 */
export type FighterId = "kinetic" | "cryo" | "inferno" | "jinzo";

export interface FighterDef {
  id: FighterId;
  name: string;
  /** One line under the name on the select screen. */
  title: string;
  /** Hooded ninja, or bare-chested monk with a headband. */
  style: "ninja" | "monk";
  /** Costume: base, shadow and highlight. */
  main: string;
  dark: string;
  light: string;
  /** Under-suit (ninja) or trousers (monk). */
  under: string;
  underDark: string;
  skin: string;
  skinDark: string;
  /** Eye glow. Ninjas only. */
  eyes: string;
  special: {
    name: string;
    /** Outer glow, body, white-hot core. */
    glow: string;
    body: string;
    core: string;
  };
}

export const FIGHTERS: Record<FighterId, FighterDef> = {
  kinetic: {
    id: "kinetic",
    name: "KINETIC",
    title: "Keeper of the Ledger",
    style: "ninja",
    main: "#8fdc0a",
    dark: "#4d7d00",
    light: "#d2ff73",
    under: "#17191c",
    underDark: "#0a0b0d",
    skin: "#d9a27c",
    skinDark: "#a8714f",
    eyes: "#f4ffd9",
    special: { name: "Mero Bolt", glow: "rgba(165,255,17,0.45)", body: "#a5ff11", core: "#f6ffe0" },
  },
  cryo: {
    id: "cryo",
    name: "CRYO",
    title: "Frost of the North Node",
    style: "ninja",
    main: "#2f7df0",
    dark: "#163f8c",
    light: "#8cc4ff",
    under: "#14161b",
    underDark: "#08090c",
    skin: "#d6a07a",
    skinDark: "#a36d4c",
    eyes: "#e3f6ff",
    special: { name: "Ice Shard", glow: "rgba(120,200,255,0.5)", body: "#7cc8ff", core: "#ffffff" },
  },
  inferno: {
    id: "inferno",
    name: "INFERNO",
    title: "Spectre of the Burned Fork",
    style: "ninja",
    main: "#f2b01e",
    dark: "#9c6200",
    light: "#ffe28a",
    under: "#17141a",
    underDark: "#0a080c",
    skin: "#caa085",
    skinDark: "#93694f",
    eyes: "#fff3c4",
    special: { name: "Hellfire", glow: "rgba(255,120,20,0.5)", body: "#ff7a1a", core: "#fff1b0" },
  },
  jinzo: {
    id: "jinzo",
    name: "JINZO",
    title: "Monk of the Open Gossip",
    style: "monk",
    main: "#d42a2a",
    dark: "#7e1010",
    light: "#ff6b5e",
    under: "#1b1b20",
    underDark: "#0b0b0e",
    skin: "#e0a87e",
    skinDark: "#a86c48",
    eyes: "#ffffff",
    special: { name: "Dragon Flame", glow: "rgba(255,60,20,0.5)", body: "#ff4a1a", core: "#ffe08a" },
  },
};

export const ROSTER: FighterDef[] = [FIGHTERS.kinetic, FIGHTERS.cryo, FIGHTERS.inferno, FIGHTERS.jinzo];

export function fighterOf(id: string | undefined | null): FighterDef {
  return (id && FIGHTERS[id as FighterId]) || FIGHTERS.kinetic;
}
