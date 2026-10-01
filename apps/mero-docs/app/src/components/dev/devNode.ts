// Dev-only: `?node=<n>` points this window at rig node n, so two windows on two
// origins (localhost and 127.0.0.1) can drive two nodes at once.
export interface DevNode {
  index: number;
  url: string;
  online: boolean;
  /** online | isolated (peers cut, rpc serving) | stopped. */
  state?: 'online' | 'isolated' | 'stopped' | 'starting';
  accessToken: string;
  refreshToken: string;
}

export interface DevNodes {
  applicationId: string;
  nodes: DevNode[];
}

export async function fetchDevNodes(): Promise<DevNodes> {
  const resp = await fetch('/__dev/nodes');
  if (!resp.ok) throw new Error(`GET /__dev/nodes -> ${resp.status}`);
  return (await resp.json()) as DevNodes;
}

export async function setDevNodeOnline(
  index: number,
  online: boolean,
): Promise<void> {
  const action = online ? 'online' : 'offline';
  const resp = await fetch(`/__dev/node/${index}/${action}`, { method: 'POST' });
  if (!resp.ok) throw new Error(`POST /__dev/node/${index}/${action} -> ${resp.status}`);
}

/** The JWT's exp in milliseconds, so the client refreshes on the real deadline. */
function tokenExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const exp = (JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** The node this window was opened against, or null when `?node` is absent. */
export function selectedDevNode(): number | null {
  const raw = new URLSearchParams(window.location.search).get('node');
  const index = Number(raw);
  return raw !== null && Number.isInteger(index) && index > 0 ? index : null;
}

/**
 * Writes the rig's session for the selected node into the storage mero-react
 * reads, before the provider's first render. Silent without `?node=` or
 * without the rig.
 */
export async function applyDevNodeSelection(): Promise<void> {
  // No `?node=`, no session: an unasked-for one would sign every visitor in.
  const selected = selectedDevNode();
  if (selected === null) return;
  let nodes: DevNodes;
  try {
    nodes = await fetchDevNodes();
  } catch {
    return;
  }
  const node = nodes.nodes.find((n) => n.index === selected);
  if (!node) return;
  const expiresAt = tokenExpiry(node.accessToken) ?? Date.now() + 3_600_000;
  localStorage.setItem(
    'mero-tokens',
    JSON.stringify({
      access_token: node.accessToken,
      refresh_token: node.refreshToken,
      expires_at: expiresAt,
    }),
  );
  localStorage.setItem('mero:expires_at', String(expiresAt));
  localStorage.setItem('mero:node_url', node.url);
  localStorage.setItem('mero:application_id', nodes.applicationId);
}
