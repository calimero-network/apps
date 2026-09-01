// Tile registry. Ids are u8 and must match logic/src/lib.rs docs.

export const AIR = 0;
export const DIRT = 1;
export const GRASS = 2;
export const STONE = 3;
export const SAND = 4;
export const WOOD = 5;
export const LEAVES = 6;
export const PLANK = 7;
export const TORCH = 8;
export const ORE_COAL = 9;
export const ORE_IRON = 10;
export const ORE_GOLD = 11;
export const WATER = 12;
export const BEDROCK = 13;
export const BRICK = 14;
export const GLASS = 15;

export interface TileDef {
  id: number;
  name: string;
  solid: boolean;
  opaque: boolean;
  /** emitted light 0..15 */
  emissive: number;
  /** seconds of digging to break (Infinity = unbreakable) */
  hardness: number;
  /** base color, hex rgb */
  color: number;
  /** what lands in the inventory when mined (usually itself) */
  drops: number;
}

function def(
  id: number,
  name: string,
  color: number,
  opts: Partial<Omit<TileDef, "id" | "name" | "color">> = {},
): TileDef {
  return {
    id,
    name,
    color,
    solid: opts.solid ?? true,
    opaque: opts.opaque ?? true,
    emissive: opts.emissive ?? 0,
    hardness: opts.hardness ?? 0.5,
    drops: opts.drops ?? id,
  };
}

export const TILES: TileDef[] = [];
TILES[AIR] = def(AIR, "air", 0x000000, { solid: false, opaque: false, hardness: Infinity });
TILES[DIRT] = def(DIRT, "dirt", 0x8a5a33, { hardness: 0.3 });
TILES[GRASS] = def(GRASS, "grass", 0x4f9c3a, { hardness: 0.3, drops: DIRT });
TILES[STONE] = def(STONE, "stone", 0x7e8288, { hardness: 0.8 });
TILES[SAND] = def(SAND, "sand", 0xd9cf94, { hardness: 0.3 });
TILES[WOOD] = def(WOOD, "wood", 0x6b5233, { solid: false, opaque: false, hardness: 0.6 });
TILES[LEAVES] = def(LEAVES, "leaves", 0x3f7d2c, { solid: false, opaque: false, hardness: 0.1 });
TILES[PLANK] = def(PLANK, "plank", 0xb08a55, { hardness: 0.5 });
TILES[TORCH] = def(TORCH, "torch", 0xffd977, {
  solid: false,
  opaque: false,
  emissive: 14,
  hardness: 0.05,
});
TILES[ORE_COAL] = def(ORE_COAL, "coal", 0x3a3f45, { hardness: 1.1 });
TILES[ORE_IRON] = def(ORE_IRON, "iron", 0xc9a488, { hardness: 1.4 });
TILES[ORE_GOLD] = def(ORE_GOLD, "gold", 0xe8c34a, { hardness: 1.8 });
TILES[WATER] = def(WATER, "water", 0x3f76e4, {
  solid: false,
  opaque: false,
  hardness: Infinity,
});
TILES[BEDROCK] = def(BEDROCK, "bedrock", 0x26262b, { hardness: Infinity });
TILES[BRICK] = def(BRICK, "brick", 0xa2523f, { hardness: 0.9 });
TILES[GLASS] = def(GLASS, "glass", 0xcfeef7, { opaque: false, hardness: 0.2 });

export function tileDef(id: number): TileDef {
  return TILES[id] ?? TILES[AIR];
}

export const isSolid = (id: number) => tileDef(id).solid;
export const isOpaque = (id: number) => tileDef(id).opaque;
export const emissive = (id: number) => tileDef(id).emissive;
export const breakable = (id: number) => Number.isFinite(tileDef(id).hardness);

/** placeable tiles on the hotbar, in order */
export const HOTBAR: number[] = [DIRT, STONE, PLANK, TORCH, WOOD, SAND, BRICK, GLASS, LEAVES];

/** starting inventory so building is fun before the first mine run */
export const STARTING_INVENTORY: Record<number, number> = {
  [TORCH]: 30,
  [PLANK]: 40,
};
