const getUrlParam = (name: string): string => {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get(name)?.trim() || "";
};

/** Application ID: URL param `app-id` > env VITE_APPLICATION_ID > fallback */
export function getApplicationId(): string {
  return (
    getUrlParam("app-id") ||
    import.meta.env.VITE_APPLICATION_ID ||
    "37poFMF4VaNgfyeaKdGbiacWsCjySJxrtgakT8EFyVL1"
  );
}

/** Application path (WASM URL): URL param `app-path` > env VITE_APPLICATION_PATH > fallback */
export function getApplicationPath(): string {
  return (
    getUrlParam("app-path") ||
    import.meta.env.VITE_APPLICATION_PATH ||
    "https://calimero-only-peers-dev.s3.amazonaws.com/uploads/03ab62aa4676a3ecd8ca3f9da23e8923.wasm"
  );
}

/** Context ID: URL param `context-id` > env VITE_CONTEXT_ID > empty (user selects on node) */
export function getContextIdFromUrl(): string {
  return getUrlParam("context-id") || import.meta.env.VITE_CONTEXT_ID || "";
}

/** @deprecated Use getApplicationId() for dynamic app-id (URL/env). */
export const APPLICATION_ID =
  import.meta.env.VITE_APPLICATION_ID ||
  "37poFMF4VaNgfyeaKdGbiacWsCjySJxrtgakT8EFyVL1";
/** @deprecated Use getApplicationPath() for dynamic app-path (URL/env). */
export const APPLICATION_PATH =
  import.meta.env.VITE_APPLICATION_PATH ||
  "https://calimero-only-peers-dev.s3.amazonaws.com/uploads/03ab62aa4676a3ecd8ca3f9da23e8923.wasm";
/** @deprecated Use getContextIdFromUrl() for dynamic context-id (URL/env). */
export const CONTEXT_ID = import.meta.env.VITE_CONTEXT_ID || "";
