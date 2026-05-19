// v9 namespace-based mero-drive config.
//
// Primary source of the applicationId is `useMero().applicationId` —
// MeroProvider resolves it at login-time from (VITE_PACKAGE_NAME +
// VITE_REGISTRY_URL) and exposes it via useMero. Non-component code
// that can't call useMero() reads the raw `VITE_APPLICATION_ID` env
// var as a fallback. No URL-param override (use .env.local instead).

import { CAPABILITIES } from '@calimero-network/mero-js';

/** Env-configured app id. Fallback for non-component contexts. */
export const ENV_APPLICATION_ID: string =
  (import.meta.env.VITE_APPLICATION_ID as string | undefined)?.trim() || '';

// Service ids inside the multi-service bundle. Must match the
// `services[].name` fields written by `logic/build-bundle.sh`.
export const REGISTRY_SERVICE_ID = 'registry';
export const DOCS_SERVICE_ID = 'docs';

// Alias used to find (or create) the Registry context inside a namespace.
export const REGISTRY_CONTEXT_ALIAS = 'Registry';

// Member-capability bitmask bits — re-exported verbatim from
// @calimero-network/mero-js's CAPABILITIES (core's `MemberCapabilities`,
// crates/context/config). This is the ONLY capability vocabulary in the
// app; the per-(folder,member) "viewer vs editor on docs" concept is the
// registry `Role`, not a cap bit. See design spec §5.1.
export {
  CAPABILITIES,
  hasCap,
  withCap,
  withoutCap,
} from '@calimero-network/mero-js';
export type { CapabilityName, CapabilityBit } from '@calimero-network/mero-js';

/** Default capability bitmask granted to members who join a workspace
 *  (namespace) by invite — the "Editor" preset: join open folders +
 *  create folders + create document contexts. Set via
 *  `mero.admin.setDefaultCapabilities(namespaceId, DEFAULT_NEW_MEMBER_CAPS)`
 *  at workspace-creation time (see `useDriveWorkspace.createWorkspace`),
 *  and re-used as the "Editor" preset by `MemberRoleSelect`. Equals 37
 *  (`CAN_CREATE_CONTEXT | CAN_JOIN_OPEN_SUBGROUPS | CAN_CREATE_SUBGROUP`).
 *  See design spec §5.2 / §5.3. */
export const DEFAULT_NEW_MEMBER_CAPS: number =
  CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS |
  CAPABILITIES.CAN_CREATE_SUBGROUP |
  CAPABILITIES.CAN_CREATE_CONTEXT;

// Client-side depth cap for nested folders (UI refuses to create deeper).
// Backend doesn't enforce — per spec it's an app-layer UX cap.
export const MAX_FOLDER_DEPTH = 8;

// Client-side cap on workspace / folder alias length. Enforced at
// both input-level (maxLength attr) and pre-submit. Long enough for
// any reasonable name, short enough to prevent accidental or
// automated abuse. Shared between NamespaceCreateDialog,
// NewFolderDialog, and FolderTreeItem's inline rename.
export const MAX_ALIAS_LENGTH = 128;
