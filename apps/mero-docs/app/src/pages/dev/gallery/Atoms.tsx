import * as React from 'react';

import { TagChip, TagDot } from '@/components/tags/TagChip';
import { LivePill } from '@/components/common/LivePill';
import { Highlight } from '@/components/common/Highlight';
import { Kbd } from '@/components/common/Kbd';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { TAG_COLORS } from '@/lib/tags';

export const title = 'Atoms';
export const order = 0;

export function Gallery(): React.JSX.Element {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Tag chip</h3>
        <div className="flex flex-wrap items-center gap-2">
          <TagChip name="roadmap" color={TAG_COLORS[0]} />
          <TagChip name="brand" color={TAG_COLORS[6]} size="lg" />
          <TagChip name="q3" color={TAG_COLORS[7]} onRemove={() => {}} />
          <TagChip name="untagged" />
          <TagDot color={TAG_COLORS[2]} />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Live pill</h3>
        <LivePill label="Bob is here" />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Highlight</h3>
        <p className="text-sm">
          <Highlight text="The roadmap commits us to a q3 launch" ranges={[{ start: 4, end: 11 }]} />
        </p>
        <p className="text-sm">
          <Highlight text="Café naïve" ranges={[{ start: 0, end: 4 }]} />
        </p>
        <p className="text-sm">
          {/* the range only names the rocket's high surrogate; it must expand to cover the whole emoji */}
          <Highlight text="Launch 🚀 party" ranges={[{ start: 7, end: 8 }]} />
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Key cap</h3>
        <Kbd>⌘K</Kbd>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Popover</h3>
        <Popover>
          <PopoverTrigger className="rounded-md border px-3 py-1.5 text-sm">Open popover</PopoverTrigger>
          <PopoverContent>Popover content</PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
