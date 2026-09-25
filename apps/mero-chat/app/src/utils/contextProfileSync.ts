export type ContextProfileSyncAction = "apply-global-name" | "ready";

export function getContextProfileSyncAction(params: {
  globalName: string;
  contextUsername: string;
}): ContextProfileSyncAction {
  const globalName = params.globalName.trim();
  const contextUsername = params.contextUsername.trim();

  if (!globalName || contextUsername === globalName) {
    return "ready";
  }

  return "apply-global-name";
}
