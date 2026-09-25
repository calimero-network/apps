import { useCallback, useState } from 'react';
import type { UseDocsState } from './useDocs';

const NEW_DOC_TITLE = 'Untitled'; // renamed in the editor header right after opening

/** Create an Untitled doc in `folderId` and open it, tracking progress and failure. */
export function useCreateDocument(
  docs: Pick<UseDocsState, 'create'>,
  folderId: string,
  onOpenDoc: (folderId: string, docId: string) => void,
) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const id = await docs.create({ title: NEW_DOC_TITLE });
      onOpenDoc(folderId, id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [docs, folderId, onOpenDoc]);

  return { create, creating, error };
}
