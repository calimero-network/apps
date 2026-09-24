// Convergence assertions, read from the nodes rather than from the windows.

import { digestOnNode, waitForValue, type DocRef } from './rpc';

const CONVERGE_TIMEOUT_MS = 180_000;

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
  const [first, ...rest] = nodes;
  const expected = await waitForSettled(() => digestOnNode(first, doc));
  await expectDigest(doc, rest, expected);
  return expected;
}

/** Two identical reads in a row: a value still moving is not a result. */
async function waitForSettled(read: () => Promise<string>): Promise<string> {
  const deadline = Date.now() + CONVERGE_TIMEOUT_MS;
  let previous = await read();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const current = await read();
    if (current === previous) return current;
    previous = current;
    if (Date.now() > deadline) throw new Error('digest never stopped moving');
  }
}
