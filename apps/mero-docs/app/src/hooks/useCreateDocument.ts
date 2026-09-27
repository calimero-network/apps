import { useCallback, useRef, useState } from 'react';
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
  // Guards every caller (button, context menu, pending-then-expand flow) at
  // the one place they all go through, so a double click can't create twice.
  const inFlightRef = useRef(false);

  const create = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setCreating(true);
    setError(null);
    try {
      const id = await docs.create({ title: NEW_DOC_TITLE });
      onOpenDoc(folderId, id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current = false;
      setCreating(false);
    }
  }, [docs, folderId, onOpenDoc]);

  return { create, creating, error };
}
