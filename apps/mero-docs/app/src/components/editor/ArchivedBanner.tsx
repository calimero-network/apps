import * as React from 'react';
import { Archive } from 'lucide-react';

import { Button } from '@/components/ui/button';

// The slim bar under the editor header while the document is archived; Unarchive only for editors.
export function ArchivedBanner({ onUnarchive }: { onUnarchive?: () => void }) {
  return (
    <div className="flex min-h-[38px] items-center gap-2.5 border-b bg-muted py-1 pl-4 pr-2 text-[12.5px] text-muted-foreground">
      <Archive aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span role="status" className="min-w-0 flex-1">
        This document is archived
      </span>
      {onUnarchive && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2.5 text-xs"
          onClick={onUnarchive}
        >
          Unarchive
        </Button>
      )}
    </div>
  );
}
