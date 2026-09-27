import * as React from 'react';
import { Folder } from 'lucide-react';

import { safeColor } from '@/utils/validation';

// A folder's colour square, or the folder glyph when it has no usable colour.
export function FolderSwatch({ color }: { color?: string }) {
  const swatch = safeColor(color);
  return swatch ? (
    <span
      aria-hidden
      className="h-2.5 w-2.5 shrink-0 rounded-sm border border-border/50"
      style={{ backgroundColor: swatch }}
    />
  ) : (
    <Folder
      aria-hidden
      className="h-[13px] w-[13px] shrink-0 text-muted-foreground"
    />
  );
}
