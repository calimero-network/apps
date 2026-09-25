/**
 * Mero Sheets — the hero: the real app, recorded, not a drawing of it.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * `public/landing/hero.webm` is two people in one workbook at the same moment:
 * you fill in a number while Ada walks up to another cell and changes it, and
 * every total that reads either cell recomputes. It is recorded by
 * `pnpm landing:media` against a real merod node running the real contract —
 * see e2e/media/capture-landing-media.spec.ts for how, and for what stands in
 * for the second person.
 *
 * Recorded at the same ratio as the stage's 495x341 design box (STAGE_DESIGN_W
 * in LandingPage.tsx), so it fills `.cal-lp-a` without cropping and scales with
 * it on a phone.
 */
export default function SheetsAnimation() {
  // Where the reader asked for less motion, the poster stands in for the loop.
  const still =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <div className="cal-lp-a" style={{ padding: 0 }}>
      <video
        src="/landing/hero.webm"
        poster="/landing/hero-poster.jpg"
        autoPlay={!still}
        muted
        loop
        playsInline
        preload="auto"
        aria-label="Two people editing the same Mero Sheets budget live: a teammate changes a cell while you type, and the totals recompute."
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  );
}
