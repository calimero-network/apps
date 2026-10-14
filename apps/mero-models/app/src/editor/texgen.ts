import type { BakeMaps } from "./bake";

/**
 * Smart materials: PBR texture sets generated from a mesh's baked maps.
 *
 * A material is a base (colour, roughness, metalness) and layers painted over
 * it through masks — worn edges, dirt in cavities and occlusion, dust on
 * up-facing surfaces, patches of 3D noise — the way texturing tools stack
 * them. Noise is sampled at each texel's object-space position, so it runs
 * straight across UV seams.
 *
 * Output is three textures in the glTF layout three.js and every engine
 * read: base colour (sRGB), occlusion/roughness/metalness packed in R/G/B
 * (linear), and a tangent-space normal map (linear, +Y up).
 */

export type MaskSource = "all" | "edges" | "cavity" | "occlusion" | "top" | "bottom" | "noise";

export interface Layer {
  name: string;
  /** Hex sRGB, or "{color}" for the object's own colour. */
  color: string;
  roughness: number;
  metalness: number;
  mask: MaskSource;
  invert?: boolean;
  /** How much of the mask's range shows (0 none, 1 all of it). */
  amount: number;
  /** How hard the mask's edge is. */
  contrast: number;
  /** How much noise breaks the mask up (0–1), and the noise's features per metre. */
  breakup: number;
  scale: number;
  opacity: number;
  /** Bumpiness this layer adds where it shows. */
  bump?: number;
}

export interface SmartMaterial {
  key: string;
  name: string;
  base: { color: string; roughness: number; metalness: number };
  /** Colour and roughness noise on the base (0–1). */
  variation: number;
  roughVariation: number;
  layers: Layer[];
  /** How strongly baked occlusion goes into the occlusion channel (0–1). */
  ao: number;
  /** Surface bump from noise, and its features per metre. */
  bump: number;
  bumpScale: number;
}

const layer = (l: Partial<Layer> & Pick<Layer, "name" | "color" | "mask">): Layer => ({
  roughness: 0.6,
  metalness: 0,
  amount: 0.5,
  contrast: 4,
  breakup: 0.3,
  scale: 6,
  opacity: 1,
  ...l,
});

export const SMART_MATERIALS: SmartMaterial[] = [
  {
    key: "painted-metal",
    name: "Painted metal, worn",
    base: { color: "#8f959c", roughness: 0.32, metalness: 1 },
    variation: 0.05,
    roughVariation: 0.15,
    layers: [
      layer({ name: "Paint", color: "{color}", roughness: 0.5, mask: "edges", invert: true, amount: 0.62, contrast: 7, breakup: 0.45, scale: 9 }),
      layer({ name: "Dirt in crevices", color: "#3b3024", roughness: 0.95, mask: "cavity", amount: 0.55, contrast: 3, breakup: 0.5, scale: 5, opacity: 0.85 }),
      layer({ name: "Grime", color: "#2a2621", roughness: 0.9, mask: "occlusion", amount: 0.4, contrast: 2, breakup: 0.4, opacity: 0.6 }),
      layer({ name: "Dust", color: "#b9b2a6", roughness: 1, mask: "top", amount: 0.3, contrast: 2, breakup: 0.6, scale: 4, opacity: 0.3 }),
    ],
    ao: 1,
    bump: 0.15,
    bumpScale: 30,
  },
  {
    key: "rusted-iron",
    name: "Rusted iron",
    base: { color: "#55524e", roughness: 0.55, metalness: 0.9 },
    variation: 0.1,
    roughVariation: 0.2,
    layers: [
      layer({ name: "Rust", color: "#7a3a17", roughness: 0.95, mask: "noise", amount: 0.5, contrast: 3, breakup: 0.35, scale: 4, bump: 0.6 }),
      layer({ name: "Deep rust", color: "#4f220c", roughness: 1, mask: "cavity", amount: 0.6, contrast: 3, breakup: 0.5, scale: 7 }),
      layer({ name: "Worn edges", color: "#b0b4b8", roughness: 0.25, metalness: 1, mask: "edges", amount: 0.5, contrast: 5, breakup: 0.3, scale: 12 }),
    ],
    ao: 1,
    bump: 0.3,
    bumpScale: 25,
  },
  {
    key: "painted-plastic",
    name: "Plastic, scuffed",
    base: { color: "{color}", roughness: 0.42, metalness: 0 },
    variation: 0.03,
    roughVariation: 0.1,
    layers: [
      layer({ name: "Scuffs", color: "#e6e6e6", roughness: 0.65, mask: "edges", amount: 0.45, contrast: 4, breakup: 0.5, scale: 14, opacity: 0.3 }),
      layer({ name: "Dirt", color: "#3a332b", roughness: 0.9, mask: "cavity", amount: 0.5, contrast: 3, breakup: 0.4, opacity: 0.6 }),
    ],
    ao: 0.9,
    bump: 0.05,
    bumpScale: 60,
  },
  {
    key: "gun-metal",
    name: "Gun metal",
    base: { color: "#3a3e44", roughness: 0.3, metalness: 1 },
    variation: 0.04,
    roughVariation: 0.15,
    layers: [
      layer({ name: "Polished edges", color: "#aeb4bb", roughness: 0.18, metalness: 1, mask: "edges", amount: 0.55, contrast: 6, breakup: 0.25, scale: 14 }),
      layer({ name: "Oil in crevices", color: "#15171a", roughness: 0.55, metalness: 0.6, mask: "cavity", amount: 0.6, contrast: 3, breakup: 0.3 }),
    ],
    ao: 1,
    bump: 0.05,
    bumpScale: 50,
  },
  {
    key: "gold",
    name: "Brushed gold",
    base: { color: "#e2b24f", roughness: 0.28, metalness: 1 },
    variation: 0.04,
    roughVariation: 0.2,
    layers: [layer({ name: "Tarnish", color: "#5a4520", roughness: 0.5, metalness: 0.6, mask: "cavity", amount: 0.6, contrast: 3, breakup: 0.4 })],
    ao: 1,
    bump: 0.04,
    bumpScale: 80,
  },
  {
    key: "rubber",
    name: "Rubber",
    base: { color: "#232427", roughness: 0.88, metalness: 0 },
    variation: 0.06,
    roughVariation: 0.1,
    layers: [layer({ name: "Dust", color: "#8a857c", roughness: 1, mask: "top", amount: 0.35, contrast: 2, breakup: 0.6, scale: 5, opacity: 0.4 })],
    ao: 1,
    bump: 0.1,
    bumpScale: 70,
  },
  {
    key: "concrete",
    name: "Concrete",
    base: { color: "#8b8a84", roughness: 0.92, metalness: 0 },
    variation: 0.25,
    roughVariation: 0.08,
    layers: [
      layer({ name: "Stains", color: "#5f5d57", roughness: 0.95, mask: "noise", amount: 0.4, contrast: 2, breakup: 0.2, scale: 2 }),
      layer({ name: "Chipped edges", color: "#b0aea6", roughness: 0.9, mask: "edges", amount: 0.5, contrast: 4, breakup: 0.6, scale: 10, bump: 0.5 }),
      layer({ name: "Dirt", color: "#3d3a33", roughness: 1, mask: "cavity", amount: 0.55, contrast: 3, breakup: 0.5, opacity: 0.8 }),
    ],
    ao: 1,
    bump: 0.6,
    bumpScale: 40,
  },
  {
    key: "mossy-stone",
    name: "Mossy stone",
    base: { color: "{color}", roughness: 0.88, metalness: 0 },
    variation: 0.3,
    roughVariation: 0.1,
    layers: [
      layer({ name: "Moss", color: "#4e6b2c", roughness: 1, mask: "top", amount: 0.55, contrast: 3, breakup: 0.5, scale: 3, bump: 0.4 }),
      layer({ name: "Dark crevices", color: "#2e2c28", roughness: 1, mask: "occlusion", amount: 0.45, contrast: 2, breakup: 0.3, opacity: 0.8 }),
    ],
    ao: 1,
    bump: 0.8,
    bumpScale: 12,
  },
  {
    key: "bark",
    name: "Bark",
    base: { color: "{color}", roughness: 0.95, metalness: 0 },
    variation: 0.35,
    roughVariation: 0.05,
    layers: [layer({ name: "Furrows", color: "#2e2116", roughness: 1, mask: "noise", amount: 0.45, contrast: 4, breakup: 0.2, scale: 18, bump: 1 })],
    ao: 1,
    bump: 1.2,
    bumpScale: 25,
  },
  {
    key: "foliage",
    name: "Foliage",
    base: { color: "{color}", roughness: 0.7, metalness: 0 },
    variation: 0.35,
    roughVariation: 0.15,
    layers: [
      layer({ name: "Shade", color: "#24401c", roughness: 0.8, mask: "occlusion", amount: 0.5, contrast: 2, breakup: 0.3 }),
      layer({ name: "Sunlit tips", color: "#9fcf6a", roughness: 0.6, mask: "top", amount: 0.3, contrast: 2, breakup: 0.6, scale: 8, opacity: 0.5 }),
    ],
    ao: 1,
    bump: 0.5,
    bumpScale: 20,
  },
  {
    key: "clean",
    name: "Clean (occlusion only)",
    base: { color: "{color}", roughness: 0.5, metalness: 0 },
    variation: 0,
    roughVariation: 0,
    layers: [],
    ao: 1,
    bump: 0,
    bumpScale: 30,
  },
];

export const smartMaterial = (key: string): SmartMaterial => SMART_MATERIALS.find((m) => m.key === key) ?? SMART_MATERIALS[0]!;

// ── noise ───────────────────────────────────────────────────────────────────

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Value noise in 3D, 0–1. */
function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(fx), v = s(fy), w = s(fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

/** Three octaves of value noise, 0–1. */
export function fbm(x: number, y: number, z: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < 3; o += 1) {
    sum += noise3(x * f, y * f, z * f, seed + o * 17) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return sum / 0.875;
}

// ── colour ──────────────────────────────────────────────────────────────────

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToLinear(hex: string): [number, number, number] {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? "808080";
  return [0, 2, 4].map((i) => toLinear(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number];
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ── generation ──────────────────────────────────────────────────────────────

export interface TextureSet {
  size: number;
  /** RGBA8, rows top to bottom (V = 1 first), as a PNG stores them. */
  baseColor: Uint8Array;
  orm: Uint8Array;
  normal: Uint8Array;
}

/**
 * The three textures of `material` on a mesh's baked maps. `color` fills any
 * "{color}". Yields to the page as it goes.
 */
export async function generate(maps: BakeMaps, material: SmartMaterial, color: string, seed = 1, onProgress?: (done: number) => void): Promise<TextureSet> {
  const { size } = maps;
  const texels = size * size;
  const resolve = (c: string) => hexToLinear(c === "{color}" ? color : c);
  const base = resolve(material.base.color);
  const layers = material.layers.map((l) => ({ ...l, rgb: resolve(l.color) }));
  const baseColor = new Uint8Array(texels * 4);
  const orm = new Uint8Array(texels * 4);
  const normal = new Uint8Array(texels * 4);
  // Height for the bump, per texel; its slopes come from neighbouring texels below.
  const height = new Float32Array(texels);
  const bumpy = material.bump > 0 || layers.some((l) => l.bump);
  let clock = performance.now();
  for (let k = 0; k < texels; k += 1) {
    const x = maps.position[k * 3]!, y = maps.position[k * 3 + 1]!, z = maps.position[k * 3 + 2]!;
    // Base, with a little colour and roughness variation.
    const vn = fbm(x * 3, y * 3, z * 3, seed + 7) - 0.5;
    const shade = 1 + vn * material.variation * 2;
    let r = base[0] * shade, g = base[1] * shade, b = base[2] * shade;
    let rough = material.base.roughness + (fbm(x * 9, y * 9, z * 9, seed + 13) - 0.5) * material.roughVariation * 2;
    let metal = material.base.metalness;
    let h = bumpy && material.bump ? material.bump * fbm(x * material.bumpScale, y * material.bumpScale, z * material.bumpScale, seed + 101) : 0;
    for (let i = 0; i < layers.length; i += 1) {
      const l = layers[i]!;
      let raw: number;
      switch (l.mask) {
        case "all":
          raw = 1;
          break;
        case "edges":
          raw = maps.edges[k]!;
          break;
        case "cavity":
          raw = Math.max(maps.cavity[k]!, (1 - maps.ao[k]!) * 0.8);
          break;
        case "occlusion":
          raw = 1 - maps.ao[k]!;
          break;
        case "top":
          raw = maps.up[k]!;
          break;
        case "bottom":
          raw = 1 - maps.height[k]!;
          break;
        case "noise":
          raw = fbm(x * l.scale, y * l.scale, z * l.scale, seed + 31 + i);
          break;
      }
      if (l.invert) raw = 1 - raw;
      // Noise only matters where it could tip the mask: skip it where the mask is surely on or off.
      const lowest = (raw - l.breakup - (1 - l.amount)) * l.contrast + 0.5;
      const highest = (raw + l.breakup - (1 - l.amount)) * l.contrast + 0.5;
      const needNoise = l.breakup > 0 && (l.bump || (highest > 0 && lowest < 1));
      const n = needNoise ? fbm(x * l.scale, y * l.scale, z * l.scale, seed + 61 + i) : 0.5;
      const v = raw + (n - 0.5) * l.breakup * 2;
      const m = (highest <= 0 ? 0 : lowest >= 1 ? 1 : clamp01((v - (1 - l.amount)) * l.contrast + 0.5)) * l.opacity;
      r += (l.rgb[0] - r) * m;
      g += (l.rgb[1] - g) * m;
      b += (l.rgb[2] - b) * m;
      rough += (l.roughness - rough) * m;
      metal += (l.metalness - metal) * m;
      if (l.bump && m > 0) h += l.bump * m * (n - 0.5) * 2;
    }
    height[k] = h;
    const o = k * 4;
    baseColor[o] = Math.round(toSrgb(clamp01(r)) * 255);
    baseColor[o + 1] = Math.round(toSrgb(clamp01(g)) * 255);
    baseColor[o + 2] = Math.round(toSrgb(clamp01(b)) * 255);
    baseColor[o + 3] = 255;
    orm[o] = Math.round(clamp01(1 - (1 - maps.ao[k]!) * material.ao) * 255);
    orm[o + 1] = Math.round(clamp01(rough) * 255);
    orm[o + 2] = Math.round(clamp01(metal) * 255);
    orm[o + 3] = 255;
    if ((k & 1023) === 0 && performance.now() - clock > 30) {
      onProgress?.(k / texels);
      await new Promise((resolve) => setTimeout(resolve, 0));
      clock = performance.now();
    }
  }
  // Normal: the baked one, tilted by the height's slope along U and V. One texel is
  // `metresPerUv / size` metres of surface, so slopes come out per metre.
  const step = maps.metresPerUv / size;
  const strength = 0.004;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const k = y * size + x;
      let nx = maps.normal[k * 3]!, ny = maps.normal[k * 3 + 1]!, nz = maps.normal[k * 3 + 2]!;
      if (bumpy) {
        const hx = (height[y * size + Math.min(size - 1, x + 1)]! - height[y * size + Math.max(0, x - 1)]!) / (2 * step);
        // Rows run down the image while V runs up it.
        const hy = (height[Math.max(0, y - 1) * size + x]! - height[Math.min(size - 1, y + 1) * size + x]!) / (2 * step);
        nx -= hx * strength;
        ny -= hy * strength;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
      }
      const o = k * 4;
      normal[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;
    }
  }
  return { size, baseColor, orm, normal };
}

/** Which smart material suits an example part, by its name. */
export const SUGGESTED: Record<string, string> = {
  "Crate body": "painted-metal",
  Handles: "gun-metal",
  Feet: "rubber",
  Drum: "painted-metal",
  "Hazard band": "painted-plastic",
  Blade: "gun-metal",
  Guard: "gold",
  Grip: "rubber",
  Pommel: "gold",
  "Wall panel": "painted-metal",
  Pillar: "gun-metal",
  "Floor tiles": "concrete",
  Rock: "mossy-stone",
  Trunk: "bark",
  Foliage: "foliage",
  "Showcase floor": "concrete",
};
