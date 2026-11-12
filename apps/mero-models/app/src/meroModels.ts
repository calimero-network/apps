/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-models";

/**
 * The contract is called through `MeroModelsClient`, which `mero-app-build
 * codegen` writes from logic/res/abi.json (`src/generated/client.ts`): the
 * ABI's camelCase arguments, u64s as decimal strings (`u64` below). Most of
 * the records keep their u64 fields as JSON numbers, which the ABI cannot
 * describe, so the generated types are `unknown` for them (and for
 * `SceneInfo`'s `environment`): the shapes below (v1's, snake_case) type each
 * answer where it is read.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** How an object's surface looks. A light reads `color` as its light colour. */
export interface Material {
  color: string;
  metalness: number;
  roughness: number;
  opacity: number;
  emissive: string;
  wireframe: boolean;
  flat_shading: boolean;
  base_color_map: string;
  normal_map: string;
  normal_scale: number;
  orm_map: string;
  emissive_map: string;
}

/** One object in the scene. */
export interface SceneObject {
  id: string;
  name: string;
  kind: string;
  parent: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  material: Material;
  segments: number;
  intensity: number;
  created_by: string;
  created_at: number;
  updated_at: number;
}

/** The shape of a `mesh` object: a reference to the blob holding its vertices. */
export interface MeshRef {
  id: string;
  /** 64 lowercase hex characters: the `id` an upload answers. */
  blob_id: string;
  size: number;
  vertex_count: number;
  triangle_count: number;
  has_uvs: boolean;
  author: string;
  message: string;
  updated_at: number;
}

/** An image a material can use, held in a blob. */
export interface TextureRef {
  id: string;
  name: string;
  blob_id: string;
  size: number;
  width: number;
  height: number;
  mime: string;
  color_space: string;
  author: string;
  message: string;
  updated_at: number;
}

/** What surrounds the scene: its name, the background and the ambient light. */
export interface Environment {
  /** The scene's name; `""` shows the instance's name. */
  name: string;
  background: string;
  ambient_color: string;
  ambient_intensity: number;
  updated_at: number;
}

/** The scene's header. */
export interface SceneInfo {
  name: string;
  environment: Environment;
  object_count: number;
  mesh_count: number;
  texture_count: number;
  member_count: number;
  me: string;
  my_role: string;
}

/** One row of an asset's history, numbered from 1. */
export interface VersionView {
  number: number;
  kind: string;
  blob_id: string;
  size: number;
  a: number;
  b: number;
  author: string;
  message: string;
  created_at: number;
  current: boolean;
}

/** A live check-out. */
export interface LockView {
  asset_id: string;
  holder: string;
  since: number;
  expires_at: number;
  mine: boolean;
}

/** A member with their effective role. */
export interface MemberView {
  id: string;
  name: string;
  role: string;
  joined_at: number;
}

/** A u64 parameter: a canonical decimal string (D20). */
export function u64(n: number): string {
  return String(Math.max(0, Math.trunc(n)));
}
