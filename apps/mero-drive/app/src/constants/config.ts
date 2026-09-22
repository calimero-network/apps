// v9 namespace-based mero-drive config.
//
// ⚠️ The applicationId is resolved FROM THE NODE, by package — see
// `src/lib/appId.ts` and `src/hooks/useApplicationId.ts`. Neither
// `useMero().applicationId` (whoever logged in last on this origin) nor
// `VITE_APPLICATION_ID` (an id that is per-INSTALL, so a baked one goes stale
// the moment the bundle is republished) says which app this is. They survive
// below only as the fallback for a node whose application list carries no
// package at all — a raw-`.wasm` dev install — where matching cannot answer.

import { CAPABILITIES } from '@calimero-network/mero-js';

/** Env-configured app id. Last-resort fallback ONLY for a node that reports no
 *  package on any installed application; see the file header. */
export const ENV_APPLICATION_ID: string =
  (import.meta.env.VITE_APPLICATION_ID as string | undefined)?.trim() || '';

/** The app's reverse-DNS package id — the single source for both the
 *  MeroProvider registry lookup and invite deep links (the deep-link
 *  slug IS the package). */
export const PACKAGE_NAME: string =
  (import.meta.env.VITE_PACKAGE_NAME as string | undefined)?.trim() ||
  'com.calimero.mero-drive-docs';

// Canonical deep-link host. links.calimero.network resolves the app by
// package: desktop installs via Application.package, web forwards the
// full query string to the registry-published frontend.
export const DEEP_LINK_BASE = 'https://links.calimero.network';

// Service ids inside the multi-service bundle. Must match the
// `services[].name` fields in logic/Cargo.toml [workspace.metadata.calimero].
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

// Folder color presets and collaborator cursor colors. Tailwind 500 tints:
// visible on light and dark surfaces, and every one takes a 4.5:1 text color.
export const COLOR_PRESETS: Array<{ value: string; label: string }> = [
  { value: '#3b82f6', label: 'Blue' },
  { value: '#10b981', label: 'Green' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#ef4444', label: 'Red' },
  { value: '#8b5cf6', label: 'Purple' },
];
