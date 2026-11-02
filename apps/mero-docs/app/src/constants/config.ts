// mero-docs config.
//
// The package id names the app everywhere: instances are created from it in
// production (`appSource`, @calimero-apps/connect), and invite links are this
// frontend's own URL. Which cluster the frontend connects to is set by the
// VITE_CALIMERO_* variables (see .env.example), not here.

import { CAPABILITIES } from '@/calimero/capabilities';

/** The app's reverse-DNS package id. Kept from v1 (`com.calimero.mero-drive-docs`):
 *  a new id would publish a separate app. */
export const PACKAGE_NAME: string =
  (import.meta.env.VITE_CALIMERO_PACKAGE as string | undefined)?.trim() ||
  'com.calimero.mero-drive-docs';

// Capability bits: Calimero 1.0's organization capabilities under the names
// v1 gave them (the bits are the same). The per-(folder,member) "viewer vs
// editor on docs" concept is the folder role, not a cap bit.
export { CAPABILITIES, hasCap, withCap, withoutCap } from '@/calimero/capabilities';
export type { CapabilityName, CapabilityBit } from '@/calimero/capabilities';

/** Default capability bitmask granted to members who join a workspace
 *  (namespace) by invite - the "Editor" preset: join open folders +
 *  create folders + create document contexts. Set via
 *  `setCapabilities(org, DEFAULT_NEW_MEMBER_CAPS)`
 *  at workspace-creation time (see `useDriveWorkspace.createWorkspace`),
 *  and re-used as the Editor grant in `WORKSPACE_ROLE_GRANTS`. Equals 37
 *  (`CAN_CREATE_CONTEXT | CAN_JOIN_OPEN_SUBGROUPS | CAN_CREATE_SUBGROUP`).
 *  See design spec §5.2 / §5.3. */
export const DEFAULT_NEW_MEMBER_CAPS: number =
  CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS |
  CAPABILITIES.CAN_CREATE_SUBGROUP |
  CAPABILITIES.CAN_CREATE_CONTEXT;

// Client-side depth cap for nested folders (UI refuses to create deeper).
// Backend doesn't enforce - per spec it's an app-layer UX cap.
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
