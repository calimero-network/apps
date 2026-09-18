/**
 * Mero Sign — the hero animation: a document being signed.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * ⚠️ WHAT THIS REPLACES, and why. The previous version was abstract: a grey
 * pane, four grey lines, and two rectangles whose "signature" was a straight
 * accent bar growing left to right. Nothing in it read as a document or as
 * signing — it could equally have been a progress bar in any app. Reported as
 * exactly that.
 *
 * The scene now shows the one thing this product does: a sheet of paper, and a
 * pen writing a signature on it in a hand that is recognisably a hand.
 *
 * ── How the signature is drawn ───────────────────────────────────────────────
 *
 * An SVG path with `stroke-dasharray` equal to its own length and an animated
 * `stroke-dashoffset` — the standard "self-drawing line", run in reverse: the
 * cycle RESTS on the finished signature and wipes it away half way through, so
 * a still frame is a signed page rather than a blank one. The
 * path is a real cursive stroke (loops, a crossbar, a trailing flourish), not a
 * sine wave: the giveaway on a fake signature is uniform amplitude, so the
 * loops vary and the baseline drifts.
 *
 * `pathLength={1}` normalises the geometry, so the dash values are 1 and the
 * timing does not have to be re-derived when a control point moves.
 *
 * The nib rides the same path via `<animateMotion>` over the same 6s, pinned by
 * `keyTimes` to the window the ink is drawn in, so pen and ink cannot drift
 * apart — one timeline, three consumers.
 *
 * ── Colour ───────────────────────────────────────────────────────────────────
 *
 * Page tokens, never app literals: this page themes and the hero has to survive
 * dark mode. The paper is `--cal-lp-bg-1` rather than white for the same
 * reason. The ink is `--cal-lp-text`, because a signature is written in ink,
 * not in brand colour; the accent is kept for the verification tick, which is
 * the app talking rather than the person.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

/* ── The sheet ──────────────────────────────────────────────────────────── */
const PAGE_X = 138;
const PAGE_Y = 26;
const PAGE_W = 220;
const PAGE_H = 290;

/* Body copy: ragged, like prose, not a placeholder comb. */
const LINES = [68, 74, 62, 78, 58, 72, 40];

/* One cursive stroke. Deliberately uneven — see the note above. */
const SIGNATURE =
  'M 176 246 ' +
  'c 6 -16 12 -24 17 -22 c 5 2 2 18 -3 27 c -5 9 -10 11 -12 7 ' +
  'c -2 -5 4 -14 12 -19 c 8 -5 16 -6 22 -2 ' +
  'c 7 5 3 17 -3 22 c -6 5 -12 3 -11 -3 c 1 -7 9 -15 18 -18 ' +
  'c 10 -4 19 0 26 7 ' +
  'c 5 5 10 8 16 6';

/** The crossbar through the flourish — drawn last, as a hand would. */
const CROSSBAR = 'M 186 252 l 58 -6';

export default function SignAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      {/* The sheet, with a second sheet peeking behind it so it reads as paper
          in a stack rather than as a panel in a UI. */}
      <span
        className="cal-lp-a-pane"
        style={{
          left: PAGE_X + 10,
          top: PAGE_Y + 8,
          width: PAGE_W,
          height: PAGE_H,
          background: 'var(--cal-lp-bg-2)',
          borderRadius: 3,
          opacity: 0.55,
        }}
      />
      <span
        className="cal-lp-a-pane"
        style={{
          left: PAGE_X,
          top: PAGE_Y,
          width: PAGE_W,
          height: PAGE_H,
          background: 'var(--cal-lp-bg-1)',
          borderRadius: 3,
          boxShadow: 'var(--cal-lp-shadow)',
        }}
      />

      <span
        className="cal-lp-a-txt cal-lp-a-txt--head"
        style={{ left: PAGE_X + 20, top: PAGE_Y + 22 }}
      >
        Supplier agreement
      </span>

      {LINES.map((w, i) => (
        <span
          key={i}
          className="cal-lp-a-line"
          style={{
            left: PAGE_X + 20,
            top: PAGE_Y + 48 + i * 13,
            width: w * 1.9,
          }}
        />
      ))}

      {/* The signing rule, and the label under it — where a paper contract puts
          them. */}
      <span
        className="cal-lp-a-line"
        style={{
          left: PAGE_X + 20,
          top: PAGE_Y + 232,
          width: PAGE_W - 40,
          height: 1,
          background: 'var(--cal-lp-border-strong)',
        }}
      />
      <span
        className="cal-lp-a-txt cal-lp-a-txt--dim"
        style={{ left: PAGE_X + 20, top: PAGE_Y + 240, fontSize: 8.5 }}
      >
        Signed by Ana Petrović
      </span>

      {/* Ink and nib. Motion lives in landing.css (`.cal-lp-a-ink` /
          `.cal-lp-a-nib`) rather than in SMIL here, because the template's rule
          is that the FIRST frame must read correctly: a headless capture and a
          reduced-motion reader both get it, and a signature that only existed
          part-way through its own cycle photographed as a blank page. The
          keyframes therefore rest on the finished signature and wipe it away at
          51% — see the note on `.cal-lp-a-ink`.

          One 6s timeline, no per-path delays: pen and ink cannot drift apart
          when neither of them owns a clock of its own. */}
      <svg
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 495,
          height: 341,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
        viewBox="0 0 495 341"
        fill="none"
      >
        <path
          className="cal-lp-a-ink"
          d={SIGNATURE}
          pathLength={1}
          stroke="var(--cal-lp-text)"
          strokeWidth={2.1}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ ['--t' as string]: '6s' }}
        />
        <path
          className="cal-lp-a-ink cal-lp-a-ink--late"
          d={CROSSBAR}
          pathLength={1}
          stroke="var(--cal-lp-text)"
          strokeWidth={1.6}
          strokeLinecap="round"
          style={{ ['--t' as string]: '6s' }}
        />

        {/* The nib. A rotated triangle rather than a dot: a dot reads as a
            cursor, and this is the one element that has to say "pen".

            `keyPoints` pins the travel to the same 51%-86% window the ink is
            drawn in, so the pen is at the start of the stroke while the page is
            blank and at the end of it when the signature is complete. Without
            the keyTimes it ran on its own 2.7s loop and the pen finished
            writing three times per signature. */}
        <g className="cal-lp-a-nib" style={{ ['--t' as string]: '6s' }}>
          <g transform="rotate(-38)">
            <rect
              x={-1.6}
              y={-26}
              width={3.2}
              height={22}
              rx={1.4}
              fill="var(--cal-lp-text-dim)"
            />
            <path d="M -1.6 -4 L 1.6 -4 L 0 1.6 Z" fill="var(--cal-lp-text)" />
          </g>
          <animateMotion
            path={SIGNATURE}
            dur="6s"
            calcMode="linear"
            keyPoints="0;0;1;1"
            keyTimes="0;0.51;0.86;1"
            repeatCount="indefinite"
          />
        </g>
      </svg>

      {/* The app's own voice, after the ink is dry. */}
      <span
        className="cal-lp-a-txt cal-lp-a-txt--accent cal-lp-a-rise"
        style={{
          left: PAGE_X + 20,
          top: PAGE_Y + 262,
          // `cal-lp-a-rise` dips at 10% of its cycle. A NEGATIVE delay starts
          // the animation part-way through, which is the only way to move that
          // dip without a keyframe set of its own: -2.46s puts it at 4.1s, just
          // after the signature is wiped, and brings the tick back at 5.6s once
          // the ink is down. At t=0 the cycle sits at 41%, which is opacity 1 —
          // so the still frame keeps the tick.
          ['--d' as string]: '-2.46s',
          ['--t' as string]: '6s',
        }}
      >
        ✓ Verified peer-to-peer
      </span>
    </div>
  );
}
