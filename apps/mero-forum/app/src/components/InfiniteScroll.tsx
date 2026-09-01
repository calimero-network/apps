import { useEffect, useRef } from "react";

/**
 * Loads the next page when the sentinel scrolls into view.
 *
 * An IntersectionObserver rather than a scroll handler: it fires once per
 * crossing instead of on every frame, and `rootMargin` starts the fetch before
 * the reader reaches the bottom so the feed rarely visibly stalls.
 */
export default function InfiniteScroll({
  onLoadMore,
  hasMore,
  loading,
}: {
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  // Held in a ref so re-creating the callback each render does not tear the
  // observer down and rebuild it.
  const cb = useRef(onLoadMore);
  cb.current = onLoadMore;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore]);

  return (
    <>
      {loading && (
        <>
          <div className="skeleton" />
          <div className="skeleton" />
        </>
      )}
      {/* The sentinel stays mounted while there is more, so a short page that
          does not fill the viewport still triggers the next fetch. */}
      {hasMore ? <div ref={sentinel} aria-hidden /> : <div className="end">You have reached the end.</div>}
    </>
  );
}
