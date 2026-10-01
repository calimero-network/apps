// The rig's nodes, as scripts/local-rig.sh wrote them into .env.integration.
// Unlike fixtures/env.ts this is open-ended: the rich suite needs a third node.

export interface RigNode {
  index: number;
  url: string;
  accessToken: string;
}

export function rigNodes(): RigNode[] {
  const nodes: RigNode[] = [];
  for (let index = 1; ; index++) {
    const suffix = index === 1 ? '' : `_${index}`;
    const url = process.env[`E2E_NODE_URL${suffix}`];
    const accessToken = process.env[`E2E_ACCESS_TOKEN${suffix}`];
    if (!url || !accessToken) return nodes;
    nodes.push({ index, url, accessToken });
  }
}

export function rigNode(index: number): RigNode {
  const node = rigNodes().find((candidate) => candidate.index === index);
  if (!node) throw new Error(`no rig node ${index} in .env.integration`);
  return node;
}

export function rigAvailable(count: number): boolean {
  return rigNodes().length >= count;
}
