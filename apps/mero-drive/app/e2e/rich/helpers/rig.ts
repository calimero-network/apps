// The rig's offline switch, driven through the dev server, and the wait for a
// node's health to settle after it.

import { rigNode } from './nodes';

const APP_URL = process.env.VITE_APP_URL ?? `http://localhost:${process.env.PW_PORT ?? '5179'}`;
const SWITCH_TIMEOUT_MS = 90_000;
const HEALTH_TIMEOUT_MS = 90_000;

export async function switchNode(node: number, action: 'offline' | 'online'): Promise<void> {
  const resp = await fetch(`${APP_URL}/__dev/node/${node}/${action}`, {
    method: 'POST',
    signal: AbortSignal.timeout(SWITCH_TIMEOUT_MS),
  });
  const body = (await resp.json()) as { ok?: boolean; output?: string };
  if (!resp.ok || body.ok !== true) {
    throw new Error(`node ${node} ${action} failed: ${body.output ?? resp.status}`);
  }
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
