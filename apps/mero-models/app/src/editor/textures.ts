import * as THREE from "three";
import type { TextureRef } from "../generated/MeroModelsClient";
import type { BlobStore } from "./blobs";

export type ColorSpaceName = "srgb" | "linear";

/**
 * Textures by blob, decoded once and shared by every material that uses them.
 *
 * Images load as `HTMLImageElement` rather than `ImageBitmap` on purpose:
 * three's `flipY` (and GLTFExporter's handling of it) only apply to elements,
 * and every UV in this app follows three's convention — glTF imports are
 * converted on the way in.
 *
 * The same image can be used as colour in one slot and as data in another, so
 * the cache key includes the colour space.
 */
export class TextureCache {
  private cache = new Map<string, THREE.Texture>();
  private loading = new Map<string, Promise<THREE.Texture>>();
  private failed = new Set<string>();
  private listeners = new Set<() => void>();
  anisotropy = 8;

  constructor(readonly blobs: BlobStore) {}

  /** Called whenever a texture finishes loading, so materials can pick it up. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The texture if it is ready; otherwise starts loading it and returns null. */
  get(ref: TextureRef, colorSpace: ColorSpaceName): THREE.Texture | null {
    const key = `${ref.blob_id}:${colorSpace}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (!this.failed.has(key)) void this.load(ref, colorSpace).catch(() => {});
    return null;
  }

  /** The texture, loading it if needed. Rejects if the blob is not an image. */
  load(ref: TextureRef, colorSpace: ColorSpaceName): Promise<THREE.Texture> {
    const key = `${ref.blob_id}:${colorSpace}`;
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    const pending = this.loading.get(key);
    if (pending) return pending;
    const p = (async () => {
      const bytes = await this.blobs.get(ref.blob_id);
      const image = await decodeImage(bytes, ref.mime);
      const texture = new THREE.Texture(image);
      texture.colorSpace = colorSpace === "srgb" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = this.anisotropy;
      texture.name = ref.name;
      texture.needsUpdate = true;
      this.cache.set(key, texture);
      for (const fn of this.listeners) fn();
      return texture;
    })()
      .catch((e) => {
        this.failed.add(key);
        throw e;
      })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, p);
    return p;
  }

  dispose(): void {
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
    this.listeners.clear();
  }
}

export async function decodeImage(bytes: ArrayBuffer | Uint8Array, mime: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    // The decoded pixels stay with the element; the URL is no longer needed.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Width, height and a sniffed mime type for an image file, for the texture record. */
export async function inspectImage(bytes: Uint8Array): Promise<{ width: number; height: number; mime: string }> {
  const mime = sniffMime(bytes);
  if (!mime) throw new Error("That file is not a PNG, JPEG or WebP image.");
  const image = await decodeImage(bytes, mime);
  return { width: image.naturalWidth, height: image.naturalHeight, mime };
}

export function sniffMime(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return null;
}
