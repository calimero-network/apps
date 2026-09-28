// Opens a document at the block a `#b=` link names, once per navigation, so
// later edits never pull the reader back; a block still syncing lands on arrival.

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
  /** Changes whenever the document does, so a missing block is looked for again. */
  revision?: unknown;
  scrollRef: RefObject<HTMLElement | null>;
  sectionOf: (block: string) => string;
  wash: (block: string | null) => void;
}

export function useSectionFocus({
  block,
  navKey,
  ready,
  revision,
  scrollRef,
  sectionOf,
  wash,
}: Options) {
  const key = `${navKey ?? ''}#${block ?? ''}`;
  const handledRef = useRef<string | null>(null);
  const awaitingRef = useRef<string | null>(null); // a navigation whose block has not arrived yet
  const washTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shown, setShown] = useState<{
    key: string;
    banner: SectionBannerState;
  } | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!block || !ready || !container) return;
    const retry = awaitingRef.current === key;
    if (handledRef.current === key && !retry) return;
    handledRef.current = key;
    const target = [
      ...container.querySelectorAll<HTMLElement>('[data-block-id]'),
    ].find((el) => el.dataset.blockId === block);
    if (!target) {
      if (retry) return;
      awaitingRef.current = key;
      container.scrollTop = 0;
      setShown({ key, banner: { variant: 'missing' } });
      return;
    }
    awaitingRef.current = null;
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
  }, [block, key, ready, revision, scrollRef, sectionOf, wash]);

  useEffect(
    () => () => {
      if (washTimerRef.current) clearTimeout(washTimerRef.current);
    },
    [],
  );

  const goTop = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [scrollRef]);
  const dismiss = useCallback(() => {
    awaitingRef.current = null;
    setShown(null);
  }, []);

  const banner = shown?.key === key ? shown.banner : null;
  return { banner, goTop, dismiss };
}
