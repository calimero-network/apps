/**
 * Mero Design — the hero: the real editor, recorded, not a drawing of it.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * `public/landing/hero.webm` is two people on one board at the same moment:
 * Ada's cursor comes in and her note lands on your screen while you recolour
 * the Sign in button. It is recorded by `pnpm landing:media` from the running
 * app, and Ada's cursor and note arrive through the app's own event stream —
 * see e2e/media/capture-landing-media.spec.ts.
 *
 * It is recorded at 1160x800, the same ratio as the stage's 495x341 design
 * box (STAGE_DESIGN_W in LandingPage.tsx), so it fills `.cal-lp-a` without
 * cropping and scales with it on a phone.
 *
 * Unlike the drawn animations this does not follow the page's dark theme — it
 * is a picture of the app, and the app is light.
 */
export default function DesignAnimation() {
  // Where the reader asked for less motion, the poster stands in for the loop.
  const still =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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
        aria-label="Two people editing the same Mero Design board live: a teammate's note appears while you recolour a button."
        style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}
