// The Text chip's popover: words a doc's title or text must hold. Applied on
// Enter, not per keystroke, so typing does not push a history entry per letter.

import * as React from 'react';

import { Input } from '@/components/ui/input';

interface Props {
  value?: string;
  onApply: (text: string | undefined) => void;
}

export function TextFilter({ value, onApply }: Props) {
  const [draft, setDraft] = React.useState(value ?? '');
  return (
    <form
      className="w-[250px] px-2 pb-2 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(draft.trim() || undefined);
      }}
    >
      <Input
        autoFocus
        aria-label="Text in the title or document"
        placeholder="Text in the title or document"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <p className="px-0.5 pt-1.5 text-[12px] text-muted-foreground">
        Press Enter to filter; every word must match
      </p>
    </form>
  );
}
