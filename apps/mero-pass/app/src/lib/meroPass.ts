/** The package a production vault is created from (`[package.metadata.calimero]`). */
export const PACKAGE = 'com.calimero.mero-pass';

/**
 * The vault's contract is called through `MeroPassClient`, which
 * `mero-app-build codegen` writes from logic/res/abi.json
 * (`src/generated/client.ts`), which types its records from the ABI: the
 * `*Wire` names below are those types (`vaultApi.ts` turns them into the
 * screens').
 */

// ── What the contract answers (u64 fields are decimal strings) ──────────────

export type {
  AuditView as AuditWire,
  DeviceView as DeviceWire,
  KeyWrapInput as KeyWrapInputWire,
  KeyWrapView as KeyWrapWire,
  MemberView as MemberWire,
  RevisionView as RevisionWire,
  SecretView as SecretWire,
  VaultInfo as VaultInfoWire,
} from '../generated/client';
