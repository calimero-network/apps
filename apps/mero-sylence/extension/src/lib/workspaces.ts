import type { Workspace } from "./messages";

export interface AppRow {
  appId: string;
  name?: string | null;
  package?: string | null;
  org?: string | null;
}

/**
 * The workspaces to offer, from the node's app list, by name.
 *
 * On Cloud a workspace is an instance of the published package. A development
 * page (`pnpm dev:local`) makes instances from a raw bundle, which the node
 * lists with no package, so with `dev` those are offered too.
 */
export function pickWorkspaces(apps: AppRow[], pkg: string, dev: boolean): Workspace[] {
  return apps
    .filter((a) => a.package === pkg || (dev && !a.package))
    .map((a) => ({ appId: a.appId, name: a.name || "Untitled workspace", ...(a.org ? { org: a.org } : {}) }))
    .sort((x, y) => x.name.localeCompare(y.name));
}
