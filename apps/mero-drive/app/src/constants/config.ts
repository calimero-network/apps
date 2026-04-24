// v9 namespace-based mero-drive config.
//
// The real APP_ID is allocated by the Calimero registry when the
// `com.calimero.mero-drive-docs-9.0.0.mpk` bundle is published. URL
// param `app-id` or env VITE_APPLICATION_ID override the built-in
// default — useful when testing against a locally-rebuilt bundle
// that the node assigned a different id to.

const getUrlParam = (name: string): string => {
  if (typeof window === 'undefined') return '';
  const fromSearch = new URLSearchParams(window.location.search).get(name)?.trim() || '';
  if (fromSearch) return fromSearch;
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get(name)?.trim() || '';
  return fromHash;
};

// Default app id of the published v9 bundle. Override per-session
// via `?app-id=<id>` URL param or `VITE_APPLICATION_ID` env var when
// testing locally-rebuilt bundles (node allocates a fresh id on each
// `merobox install`).
const DEFAULT_APPLICATION_ID = 'GfksPg4kLyLEkN5cRKvZ69rMRgD4gaM8VLxJAWQitDCq';

/** Application ID: URL param `app-id` > env VITE_APPLICATION_ID > DEFAULT_APPLICATION_ID. */
export function getApplicationId(): string {
  return (
    getUrlParam('app-id') ||
    (import.meta.env.VITE_APPLICATION_ID as string | undefined)?.trim() ||
    DEFAULT_APPLICATION_ID
  );
}

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
