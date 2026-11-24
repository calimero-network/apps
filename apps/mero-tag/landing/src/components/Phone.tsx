import { useEffect, useRef } from "react";

/** A phone frame playing one of the app's real screen recordings. */
export function Phone({ src, poster, label, className = "" }: { src: string; poster: string; label: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  // Play only while on screen, and never for people who asked for less motion.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const io = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? video.play().catch(() => {}) : video.pause()),
      { threshold: 0.35 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, []);

  return (
    <div className={`phone ${className}`}>
      <div className="phone-island" aria-hidden />
      <video ref={ref} src={src} poster={poster} muted loop playsInline preload="metadata" aria-label={label} />
    </div>
  );
}
