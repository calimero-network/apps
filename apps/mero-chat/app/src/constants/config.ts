/**
 * The open workspace: an organization id (v1's namespace / group id). Kept per
 * browser so a reload reopens it; `Home` clears it when the account is no
 * longer in that org.
 */
const WORKSPACE_KEY = "mero-chat:workspace";

function read(): string {
  try {
    return localStorage.getItem(WORKSPACE_KEY) || "";
  } catch {
    return "";
  }
}

let current = read();

export function getGroupId(): string {
  return current;
}

export function setGroupId(org: string): void {
  current = org;
  try {
    localStorage.setItem(WORKSPACE_KEY, org);
  } catch {
    /* remembered for this page only */
  }
}

export function clearGroupId(): void {
  current = "";
  try {
    localStorage.removeItem(WORKSPACE_KEY);
  } catch {
    /* nothing stored */
  }
}

export function clearWorkspaceSelection(): void {
  clearGroupId();
}
