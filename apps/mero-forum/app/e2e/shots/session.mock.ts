// Aliased over ../../src/lib/session — the pages read the active forum from it.
export const getContextId = () => "ctx-1";
export const getActiveNamespaceId = () => "ns-1";
export const getForumName = () => "Engineering";
export const getUsername = () => "Ana";
export const setUsername = () => {};
export const setForumName = () => {};
export const setActiveForum = () => {};
export const clearActiveForum = () => {};
export const getApplicationId = () => "app-1";
export const getExecutorPublicKey = () => "exec-1";
export const isDeveloperMode = () => false;
export const captureSessionFromHash = () => {};
export const nowSecs = () => Math.floor(Date.now() / 1000);
export const nowMillis = () => Date.now();
