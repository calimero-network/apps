// The offline switch, and the one sequence every merge scenario needs: two
// causally independent edits, each written while the other side is cut off.

import { rigNode, rigNodes } from './nodes';

const APP_URL = process.env.VITE_APP_URL ?? `http://localhost:${process.env.PW_PORT ?? '5179'}`;
const SWITCH_TIMEOUT_MS = 90_000;
const HEALTH_TIMEOUT_MS = 90_000;

async function switchNode(node: number, action: 'offline' | 'online'): Promise<void> {
  const resp = await fetch(`${APP_URL}/__dev/node/${node}/${action}`, {
    method: 'POST',
    signal: AbortSignal.timeout(SWITCH_TIMEOUT_MS),
  });
  const body = (await resp.json()) as { ok?: boolean; output?: string };
  if (!resp.ok || body.ok !== true) {
    throw new Error(`node ${node} ${action} failed: ${body.output ?? resp.status}`);
  }
}

export async function goOffline(node: number): Promise<void> {
  await switchNode(node, 'offline');
  await waitForHealth(node, false);
}

export async function goOnline(node: number): Promise<void> {
  await switchNode(node, 'online');
  await waitForHealth(node, true);
}

export async function waitForHealth(node: number, want: boolean): Promise<void> {
  const { url } = rigNode(node);
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    let healthy = false;
    try {
      healthy = (await fetch(`${url}/admin-api/health`, { signal: AbortSignal.timeout(3000) })).ok;
    } catch {
      healthy = false;
    }
    if (healthy === want) return;
    if (Date.now() > deadline) {
      throw new Error(`node ${node} never became ${want ? 'healthy' : 'unreachable'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export interface DivergentSide {
  node: number;
  /** Re-opens the document after the node restarted; the event stream does not survive it. */
  reopen: () => Promise<void>;
  edit: () => Promise<void>;
}

/** Runs both edits without either node seeing the other's, then reconnects
 *  everything and re-opens each window, which its node's restart had closed.
 *  Every other rig node is held offline too, so none can relay between them. */
export async function diverge(first: DivergentSide, second: DivergentSide): Promise<void> {
  const others = rigNodes()
    .map((node) => node.index)
    .filter((index) => index !== first.node && index !== second.node);
  for (const node of others) await goOffline(node);
  await goOffline(second.node);
  await first.edit();

  await goOffline(first.node);
  await goOnline(second.node);
  await second.reopen();
  await second.edit();

  await goOnline(first.node);
  for (const node of others) await goOnline(node);
  await first.reopen();
}
