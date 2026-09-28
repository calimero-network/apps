import { useEffect, useState } from 'react';

export const SM_QUERY = '(min-width: 640px)'; // Tailwind sm, where the editor header has room for undo and redo
export const MD_QUERY = '(min-width: 768px)'; // Tailwind md, where the sidebar docks
export const LG_QUERY = '(min-width: 1024px)'; // Tailwind lg, where Details docks beside the document

// Local rather than @mantine/hooks, which would pull the lazy editor chunk into the entry.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: { matches: boolean }) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
