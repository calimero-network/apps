import * as React from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { nameCollator } from '@/lib/collate';
import { filterByLabel } from '@/lib/search/match';
import { FolderPath } from './DocTable';

const FILTER_THRESHOLD = 6; // more folders than this and the list gets a filter field

interface FolderOption {
  id: string;
  name: string;
  path: string[];
  color?: string;
}

interface Props {
  open: boolean;
  folders: FolderOption[];
  onPick: (folderId: string) => void;
  onOpenChange: (open: boolean) => void;
}

export function NewDocFolderPicker({
  open,
  folders,
  onPick,
  onOpenChange,
}: Props) {
  const [query, setQuery] = React.useState('');
  const showFilter = folders.length > FILTER_THRESHOLD;
  const sorted = React.useMemo(
    () =>
      [...folders].sort((a, b) =>
        nameCollator.compare(a.path.join(' / '), b.path.join(' / ')),
      ),
    [folders],
  );
  const shown = filterByLabel(sorted, (f) => f.path.join(' / '), query);

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-sm p-0">
        <div className="px-[18px] pt-4">
          <DialogTitle className="text-[15px] tracking-[-0.01em]">
            New document in…
          </DialogTitle>
        </div>
        <div className="flex flex-col gap-2 p-2 pt-3">
          {showFilter && (
            <Input
              autoFocus
              aria-label="Filter folders"
              placeholder="Filter folders"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mx-1 w-auto"
            />
          )}
          {shown.length === 0 ? (
            <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">
              No matches
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {shown.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onPick(f.id)}
                    className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-secondary-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
                  >
                    <FolderPath path={f.path} color={f.color} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
