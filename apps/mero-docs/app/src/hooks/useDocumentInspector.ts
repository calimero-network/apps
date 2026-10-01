// What the dev panel needs to tell two nodes apart: the title, the digest both
// replicas must agree on, and one row per block. Read on demand only, so an
// inspector that nobody opened costs nothing.

import { useCallback, useState } from 'react';
import type { DocsClient } from '@/generated/docs/DocsClient';

export interface InspectorBlock {
  id: string;
  kind: string;
  depth: number;
  attrs: Record<string, string>;
  text: string;
}

export interface DocumentSnapshot {
  title: string;
  digest: string;
  blocks: InspectorBlock[];
  readAt: number;
}

export interface UseDocumentInspectorResult {
  snapshot: DocumentSnapshot | null;
  loading: boolean;
  error: Error | null;
  read: () => Promise<void>;
}

export function useDocumentInspector(
  client: DocsClient | null,
  docId: string | null,
): UseDocumentInspectorResult {
  const [snapshot, setSnapshot] = useState<DocumentSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const read = useCallback(async () => {
    if (!client || !docId) return;
    setLoading(true);
    try {
      const [title, digest, rows] = await Promise.all([
        client.getTitle({ doc: docId }),
        client.getStateDigest({ doc: docId }),
        client.getDocument({ doc: docId }),
      ]);
      setSnapshot({
        title,
        digest,
        blocks: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          depth: row.depth,
          attrs: row.attrs,
          text: row.spans.map((span) => span.text).join(''),
        })),
        readAt: Date.now(),
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setLoading(false);
    }
  }, [client, docId]);

  return { snapshot, loading, error, read };
}
