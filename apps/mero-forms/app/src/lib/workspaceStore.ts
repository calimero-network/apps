/**
 * The workspace this browser has open, remembered across reloads, per cluster
 * and per account (`bindScope`): a dev session's workspace never opens on a
 * Cloud cluster, and the next person to sign in on this browser does not boot
 * into the previous person's workspace.
 *
 * v1 kept a context id here (through mero-react). On Calimero 1.0 a workspace
 * is an app instance in an organization, so this is the instance id and its org.
 */

export interface ActiveWorkspace {
  appId: string;
  org: string | null;
}

let scope = "signed-out";

const key = () => `mero-forms:active:${scope}`;

/** Switches to the stored state of `key` (`<target>:<account>`), or of nobody. */
export function bindScope(next: string | null): void {
  scope = next ?? "signed-out";
}

export function getActive(): ActiveWorkspace | null {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveWorkspace>;
    if (typeof parsed.appId !== "string" || !parsed.appId) return null;
    return { appId: parsed.appId, org: typeof parsed.org === "string" ? parsed.org : null };
  } catch {
    return null;
  }
}

export function setActive(active: ActiveWorkspace | null): void {
  try {
    if (active) localStorage.setItem(key(), JSON.stringify(active));
    else localStorage.removeItem(key());
  } catch {
    /* remembered for this page only */
  }
}
