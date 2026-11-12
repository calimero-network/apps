/** The package a production vault is created from (`[package.metadata.calimero]`). */
export const PACKAGE = 'com.calimero.mero-pass';

/**
 * The vault's contract is called through `MeroPassClient`, which
 * `mero-app-build codegen` writes from logic/res/abi.json
 * (`src/generated/client.ts`). The ABI names its records without their
 * shapes, so the generated types are `unknown`: the `*Wire` shapes below type
 * each answer where it is read (`vaultApi.ts` turns them into the screens').
 */

// ── What the contract answers (u64 fields are decimal strings) ──────────────

export interface VaultInfoWire {
  name: string;
  currentKey: string;
  defaultRole: string;
  myAccount: string;
  myRole: string;
}
export interface MemberWire {
  account: string;
  role: string;
  devices: number;
}
export interface DeviceWire {
  fingerprint: string;
  publicKey: string;
  label: string;
  kind: string;
  account: string;
  addedAt: string;
  revoked: boolean;
}
export interface KeyWrapWire {
  keyId: string;
  recipient: string;
  wrapper: string;
  envelope: string;
  wrappedBy: string;
}
export interface KeyWrapInputWire {
  keyId: string;
  recipient: string;
  wrapper: string;
  envelope: string;
}
export interface SecretWire {
  id: string;
  kind: string;
  name: string;
  tags: string;
  fields: Record<string, string>;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  trashed: boolean;
  trashedAt: string;
}
export interface RevisionWire {
  field: string;
  previous: string;
  replacedAt: string;
  replacedBy: string;
}
export interface AuditWire {
  action: string;
  target: string;
  account: string;
  device: string;
  timestamp: string;
  redacted: boolean;
}
