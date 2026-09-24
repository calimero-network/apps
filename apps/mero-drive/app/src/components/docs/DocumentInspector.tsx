// The editor's half of the rig console: what this node believes the open
// document is. Portals into the dev panel's slot and reads only on demand, so
// it costs nothing in a window nobody is inspecting.

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { DEV_INSPECTOR_SLOT } from '@/components/dev/DevPanel';
import type { DocsClient } from '@/generated/docs/DocsClient';
import { useDocumentInspector } from '@/hooks/useDocumentInspector';

interface Props {
  client: DocsClient | null;
  docId: string | null;
}

export function DocumentInspector({ client, docId }: Props) {
  const { snapshot, loading, error, read } = useDocumentInspector(client, docId);
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);

  useEffect(() => {
    setSlot(document.getElementById(DEV_INSPECTOR_SLOT));
  }, []);

  useEffect(() => {
    if (!slot || !client || !docId) return;
    void read();
  }, [slot, client, docId, read]);

  if (!slot) return null;

  return createPortal(
    <div data-testid="doc-inspector" className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">Document</span>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          data-testid="doc-inspector-read"
          onClick={() => void read()}
        >
          Read
        </Button>
      </div>
      {error ? (
        <p className="text-destructive">{error.message}</p>
      ) : (
        <>
          <p className="truncate text-muted-foreground">
            title <span data-testid="inspector-title">{snapshot?.title}</span>
          </p>
          <p className="truncate text-muted-foreground">
            digest{' '}
            <code data-testid="digest-value">{snapshot?.digest ?? ''}</code>
          </p>
          <ul data-testid="inspector-blocks" className="space-y-0.5">
            {(snapshot?.blocks ?? []).map((block) => (
              <li
                key={block.id}
                data-testid="inspector-block"
                data-block-id={block.id}
                className="truncate text-muted-foreground"
              >
                {block.kind}/{block.depth} {block.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>,
    slot,
  );
}
