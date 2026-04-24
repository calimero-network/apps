// v9 namespace-based mero-drive config.
//
// Primary source of the applicationId is `useMero().applicationId` —
// MeroProvider resolves it at login-time from (VITE_PACKAGE_NAME +
// VITE_REGISTRY_URL) and exposes it via useMero. Non-component code
// that can't call useMero() reads the raw `VITE_APPLICATION_ID` env
// var as a fallback. No URL-param override (use .env.local instead).

/** Env-configured app id. Fallback for non-component contexts. */
export const ENV_APPLICATION_ID: string =
  (import.meta.env.VITE_APPLICATION_ID as string | undefined)?.trim() || '';

// Service ids inside the multi-service bundle. Must match the
// `services[].name` fields written by `logic/build-bundle.sh`.
export const REGISTRY_SERVICE_ID = 'registry';
export const DOCS_SERVICE_ID = 'docs';

// Alias used to find (or create) the Registry context inside a namespace.
export const REGISTRY_CONTEXT_ALIAS = 'Registry';

// Capability bitmask bits, mirroring core's `calimero-context-config` crate.
// See design spec → Permissions Model → Capability → Action Policy Table.
export const CAP = {
  READ: 1,
  WRITE: 2,
  CREATE_GROUP: 4,
  MANAGE_GROUP: 8,
  INVITE_MEMBERS: 16,
  MANAGE_MEMBERS: 32,
} as const;

// What an inherit-mode child folder receives from its parent on cascade.
// READ | WRITE | CREATE_GROUP = 7. Admin-role bits are deliberately stripped
// so a parent-admin becomes a child-member (per spec).
export const DEFAULT_CHILD_CAP_MASK = CAP.READ | CAP.WRITE | CAP.CREATE_GROUP;

// Client-side depth cap for nested folders (UI refuses to create deeper).
// Backend doesn't enforce — per spec it's an app-layer UX cap.
export const MAX_FOLDER_DEPTH = 8;

// Client-side cap on workspace / folder alias length. Enforced at
// both input-level (maxLength attr) and pre-submit. Long enough for
// any reasonable name, short enough to prevent accidental or
// automated abuse. Shared between NamespaceCreateDialog,
// NewFolderDialog, and FolderTreeItem's inline rename.
export const MAX_ALIAS_LENGTH = 128;
