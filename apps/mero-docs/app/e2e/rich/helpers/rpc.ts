// Reads straight off a node, bypassing the browser: the only way a spec can
// claim two replicas hold the same document rather than that two windows agree.

import type { Block } from '../../../src/generated/docs/DocsClient';
import { rigNode } from './nodes';

const CALL_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 500;

export interface DocRef {
  contextId: string;
  docId: string;
}

export interface AdminContext {
  id: string;
  serviceName: string;
  groupId?: string;
}

export async function execute<T>(
  node: number,
  contextId: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { url, accessToken } = rigNode(node);
  const resp = await fetch(`${url}/jsonrpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `rich-${method}`,
      method: 'execute',
      params: { contextId, method, argsJson: args },
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`node ${node} ${method} -> ${resp.status}: ${await resp.text()}`);
  }
  const body = (await resp.json()) as {
    result?: { output?: unknown };
    error?: unknown;
  };
  if (body.error !== undefined) {
    throw new Error(`node ${node} ${method} failed: ${JSON.stringify(body.error)}`);
  }
  return body.result?.output as T;
}

export async function adminContexts(node: number): Promise<AdminContext[]> {
  const { url, accessToken } = rigNode(node);
  const resp = await fetch(`${url}/admin-api/contexts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`node ${node} contexts -> ${resp.status}: ${await resp.text()}`);
  }
  const body = (await resp.json()) as { data: { contexts: AdminContext[] } };
  return body.data.contexts;
}

/** The docs context holding a document with this exact title. Titles are unique per run. */
export async function findDoc(node: number, title: string): Promise<DocRef> {
  const candidates = (await adminContexts(node)).filter(
    (context) => context.serviceName === 'docs',
  );
  for (const context of candidates) {
    let docs: Array<{ id: string; title: string }>;
    try {
      docs = await execute(node, context.id, 'list_docs', {
        include_archived: false,
      });
    } catch {
      continue; // a docs context this node has not materialised yet
    }
    const match = docs.find((doc) => doc.title === title);
    if (match) return { contextId: context.id, docId: match.id };
  }
  throw new Error(`no document titled "${title}" on node ${node}`);
}

export function digestOnNode(node: number, doc: DocRef): Promise<string> {
  return execute(node, doc.contextId, 'get_state_digest', { doc: doc.docId });
}

export function titleOnNode(node: number, doc: DocRef): Promise<string> {
  return execute(node, doc.contextId, 'get_title', { doc: doc.docId });
}

export function blocksOnNode(node: number, doc: DocRef): Promise<Block[]> {
  return execute(node, doc.contextId, 'get_document', { doc: doc.docId });
}

/** The identity this node signs with in a context, which presence names as the author. */
export async function ownedIdentity(node: number, contextId: string): Promise<string> {
  const { url, accessToken } = rigNode(node);
  const resp = await fetch(`${url}/admin-api/contexts/${contextId}/identities-owned`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`node ${node} identities -> ${resp.status}: ${await resp.text()}`);
  }
  const body = (await resp.json()) as { data: { identities: string[] } };
  const [identity] = body.data.identities;
  if (!identity) throw new Error(`node ${node} owns no identity in ${contextId}`);
  return identity;
}

/** Polls `read` until it equals `want`, and reports the last value it did see. */
export async function waitForValue<T>(
  read: () => Promise<T>,
  want: T,
  opts: { timeout?: number; label?: string } = {},
): Promise<void> {
  const deadline = Date.now() + (opts.timeout ?? 120_000);
  let last: unknown = '<never read>';
  for (;;) {
    try {
      last = await read();
      if (JSON.stringify(last) === JSON.stringify(want)) return;
    } catch (cause) {
      last = `error: ${String(cause)}`;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${opts.label ?? 'value'} never reached ${JSON.stringify(want)}; last was ${JSON.stringify(last)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** Adds `identity` to the group behind `contextId` as an explicit member, from `node`. */
export async function addExplicitMember(node: number, contextId: string, identity: string): Promise<void> {
  const context = (await adminContexts(node)).find((candidate) => candidate.id === contextId);
  if (!context?.groupId) throw new Error(`node ${node} has no group for ${contextId}`);
  const { url, accessToken } = rigNode(node);
  const resp = await fetch(`${url}/admin-api/groups/${context.groupId}/members`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ members: [{ identity, role: 'Member' }] }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`node ${node} add member -> ${resp.status}: ${await resp.text()}`);
}
