// Convergence assertions, read from the nodes rather than from the windows.

import { digestOnNode, waitForValue, type DocRef } from './rpc';

const CONVERGE_TIMEOUT_MS = 180_000;
const SETTLE_POLL_MS = 2_000; // a value still moving between two polls is not a result

export async function expectDigest(
  doc: DocRef,
  nodes: number[],
  expected: string,
  timeout = CONVERGE_TIMEOUT_MS,
): Promise<void> {
  for (const node of nodes) {
    await waitForValue(() => digestOnNode(node, doc), expected, {
      timeout,
      label: `digest on node ${node}`,
    });
  }
}

/** Waits for every node to report the same digest and returns it. */
export async function settle(doc: DocRef, nodes: number[]): Promise<string> {
  return settledAcross(nodes, (node) => digestOnNode(node, doc));
}

/**
 * Polls every node until all report one value on two polls in a row. Reading
 * one node first would freeze a value a peer's late write has yet to move.
 */
export async function settledAcross(
  nodes: number[],
  read: (node: number) => Promise<string>,
  { interval = SETTLE_POLL_MS, timeout = CONVERGE_TIMEOUT_MS } = {},
): Promise<string> {
  const deadline = Date.now() + timeout;
  let previous: string | null = null;
  for (;;) {
    // A failed read is a node not answering yet, never a value it agrees on.
    const values = await Promise.all(nodes.map((node) => read(node).catch((cause: unknown) => ({ failed: String(cause) }))));
    const [first] = values;
    const agreed = typeof first === 'string' && values.every((value) => value === first) ? first : null;
    if (agreed !== null && agreed === previous) return agreed;
    previous = agreed;
    if (Date.now() > deadline) throw new Error(`nodes ${nodes.join(', ')} never settled; last read ${JSON.stringify(values)}`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
