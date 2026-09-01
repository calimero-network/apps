// Block registry. Ids are u8 and must match logic/src/lib.rs docs.

export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 4;
export const WATER = 5;
export const WOOD = 6;
export const LEAVES = 7;
export const PLANK = 8;
export const GLASS = 9;
export const BRICK = 10;
export const TORCH = 11;
export const GLOWSTONE = 12;
export const BEDROCK = 13;
export const COBBLE = 14;
export const SNOW = 15;

export interface BlockDef {
  id: number;
  name: string;
  /** blocks player movement */
  solid: boolean;
  /** blocks light + culls neighbor faces */
  opaque: boolean;
  /** emitted block-light level 0..15 */
  emissive: number;
  /** [top, side, bottom] rgb 0..1 */
  colors: [number, number, number][];
  /** can be broken */
  breakable: boolean;
}

const rgb = (hex: number): [number, number, number] => [
  ((hex >> 16) & 0xff) / 255,
  ((hex >> 8) & 0xff) / 255,
  (hex & 0xff) / 255,
];

function def(
  id: number,
  name: string,
  opts: {
    solid?: boolean;
    opaque?: boolean;
    emissive?: number;
    top: number;
    side?: number;
    bottom?: number;
    breakable?: boolean;
  },
): BlockDef {
  return {
    id,
    name,
    solid: opts.solid ?? true,
    opaque: opts.opaque ?? true,
    emissive: opts.emissive ?? 0,
    colors: [rgb(opts.top), rgb(opts.side ?? opts.top), rgb(opts.bottom ?? opts.side ?? opts.top)],
    breakable: opts.breakable ?? true,
  };
}

export const BLOCKS: BlockDef[] = [];
BLOCKS[AIR] = def(AIR, "air", { solid: false, opaque: false, top: 0x000000, breakable: false });
BLOCKS[GRASS] = def(GRASS, "grass", { top: 0x5da43a, side: 0x7a5a34, bottom: 0x6b4a2b });
BLOCKS[DIRT] = def(DIRT, "dirt", { top: 0x7a5a34 });
BLOCKS[STONE] = def(STONE, "stone", { top: 0x8a8d90 });
BLOCKS[SAND] = def(SAND, "sand", { top: 0xd9cf94 });
BLOCKS[WATER] = def(WATER, "water", { solid: false, opaque: false, top: 0x3f76e4 });
BLOCKS[WOOD] = def(WOOD, "wood", { top: 0x6b5233, side: 0x5a4426 });
BLOCKS[LEAVES] = def(LEAVES, "leaves", { opaque: false, top: 0x3f7d2c });
BLOCKS[PLANK] = def(PLANK, "plank", { top: 0xb08a55 });
BLOCKS[GLASS] = def(GLASS, "glass", { opaque: false, top: 0xcfeef7 });
BLOCKS[BRICK] = def(BRICK, "brick", { top: 0xa2523f });
BLOCKS[TORCH] = def(TORCH, "torch", { solid: false, opaque: false, emissive: 14, top: 0xffd977 });
BLOCKS[GLOWSTONE] = def(GLOWSTONE, "glowstone", { emissive: 15, top: 0xf9e8a0 });
BLOCKS[BEDROCK] = def(BEDROCK, "bedrock", { top: 0x2e2e33, breakable: false });
BLOCKS[COBBLE] = def(COBBLE, "cobble", { top: 0x757a7d });
BLOCKS[SNOW] = def(SNOW, "snow", { top: 0xf2f6f7 });

export function blockDef(id: number): BlockDef {
  return BLOCKS[id] ?? BLOCKS[AIR];
}

export const isSolid = (id: number) => blockDef(id).solid;
export const isOpaque = (id: number) => blockDef(id).opaque;
export const emissive = (id: number) => blockDef(id).emissive;

/** blocks offered on the hotbar, in order */
export const HOTBAR: number[] = [
  GRASS,
  DIRT,
  STONE,
  PLANK,
  GLASS,
  BRICK,
  WOOD,
  TORCH,
  GLOWSTONE,
];
