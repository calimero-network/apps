/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-models";

/**
 * The contract is called through `MeroModelsClient`, which `meroctl app
 * codegen` writes from logic/res/abi.json (`src/generated/client.ts`): the
 * ABI's camelCase arguments, u64s as decimal strings (`u64` below). The
 * records keep v1's snake_case fields and their u64 fields as JSON numbers,
 * which the contract marks `#[abi(plain)]` (`u64_number`), so the generated
 * types describe them as they are.
 */
export type {
  Environment,
  LockView,
  Material,
  MemberView,
  MeshRef,
  SceneInfo,
  SceneObject,
  TextureRef,
  Vec3,
  VersionView,
} from "./generated/client";

/** A u64 parameter: a canonical decimal string (D20). */
export function u64(n: number): string {
  return String(Math.max(0, Math.trunc(n)));
}
