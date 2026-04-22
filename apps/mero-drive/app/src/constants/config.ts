// v9 namespace-based mero-drive config.
//
// The real APP_ID is allocated by the Calimero registry when the
// `com.calimero.mero-drive-docs-9.0.0.mpk` bundle is published. Until
// then we read it from a URL param (`app-id`) or the env var
// VITE_APPLICATION_ID, falling back to a placeholder that the app will
// refuse to operate against (so nobody accidentally talks to the wrong
// app id in dev).

const getUrlParam = (name: string): string => {
  if (typeof window === 'undefined') return '';
  const fromSearch = new URLSearchParams(window.location.search).get(name)?.trim() || '';
  if (fromSearch) return fromSearch;
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get(name)?.trim() || '';
  return fromHash;
};

/** Node URL: URL param `node_url` or `node-url`. Used for connect flow. */
export function getNodeUrlFromUrl(): string {
  return getUrlParam('node_url') || getUrlParam('node-url') || '';
}

/** Application ID: URL param `app-id` > env VITE_APPLICATION_ID > placeholder. */
export function getApplicationId(): string {
  return (
    getUrlParam('app-id') ||
    (import.meta.env.VITE_APPLICATION_ID as string | undefined)?.trim() ||
    // Placeholder until the v9 bundle ships to the registry. Pass
    // `?app-id=<real>` or set VITE_APPLICATION_ID to override locally.
    'REPLACE_WITH_REAL_APP_ID'
  );
}

// Service ids inside the multi-service bundle. Must match
// `logic/manifest.json`'s `services[].name`.
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
