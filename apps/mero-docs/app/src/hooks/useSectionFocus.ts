// Opens a document at the block a `#b=` link names: scrolled near the top,
// washed briefly and explained by a banner. It acts once per navigation, so
// later edits and re-renders never pull the reader back.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

export const WASH_MS = 1600; // the .section-wash animation in index.css
const TOP_GAP_PX = 24; // room above the block so it does not sit flush on the edge

export interface SectionBannerState {
  variant: 'opened' | 'missing';
  section?: string;
}

interface Options {
  /** The linked block, by the editor's id for it. */
  block?: string;
  /** One per navigation; a new one runs the focus again. */
  navKey?: string;
  /** The loaded document's blocks are on screen. */
  ready: boolean;
  scrollRef: RefObject<HTMLElement | null>;
  sectionOf: (block: string) => string;
  wash: (block: string | null) => void;
}

export function useSectionFocus({
  block,
  navKey,
  ready,
  scrollRef,
  sectionOf,
  wash,
}: Options) {
  const key = `${navKey ?? ''}#${block ?? ''}`;
  const handledRef = useRef<string | null>(null);
  const washTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shown, setShown] = useState<{
    key: string;
    banner: SectionBannerState;
  } | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!block || !ready || !container || handledRef.current === key) return;
    handledRef.current = key;
    const target = [
      ...container.querySelectorAll<HTMLElement>('[data-block-id]'),
    ].find((el) => el.dataset.blockId === block);
    if (!target) {
      container.scrollTop = 0;
      setShown({ key, banner: { variant: 'missing' } });
      return;
    }
    const offset =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top;
    container.scrollTop += offset - TOP_GAP_PX;
    wash(block);
    if (washTimerRef.current) clearTimeout(washTimerRef.current);
    washTimerRef.current = setTimeout(() => {
      washTimerRef.current = null;
      wash(null);
    }, WASH_MS);
    setShown({
      key,
      banner: { variant: 'opened', section: sectionOf(block) },
    });
  }, [block, key, ready, scrollRef, sectionOf, wash]);

  useEffect(
    () => () => {
      if (washTimerRef.current) clearTimeout(washTimerRef.current);
    },
    [],
  );

  const goTop = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [scrollRef]);
  const dismiss = useCallback(() => setShown(null), []);

  const banner = shown?.key === key ? shown.banner : null;
  return { banner, goTop, dismiss };
}
