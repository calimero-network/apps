/**
 * Mero Meet — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 *
 * ⚠️ Sized to the frame. A 2x2 grid of 96x66 tiles occupied the top-left
 * quarter; a call that fills the window is what the app looks like. Six tiles,
 * a chat strip and a control bar use the space, and the chat strip earns its
 * place — messages ride the context, and the whole claim is that signalling
 * does too while the media does not.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

const PEOPLE = ['Ana', 'Marko', 'Iva', 'Sara', 'Luka', 'You'];
const TILE_W = 148;
const TILE_H = 92;
const GRID_X = 20;
const GRID_Y = 30;

export default function MeetAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>Standup · 6 in call</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>P2P media</span>

      {PEOPLE.map((who, i) => {
        const x = GRID_X + (i % 3) * (TILE_W + 8);
        const y = GRID_Y + Math.floor(i / 3) * (TILE_H + 8);
        const d = `${0.3 + i * 0.35}s`;
        return (
          <span key={who}>
            <span className="cal-lp-a-pane cal-lp-a-rise" style={{ left: x, top: y, width: TILE_W, height: TILE_H, ['--d' as string]: d, ['--t' as string]: '6s' }} />
            <span
              className="cal-lp-a-av cal-lp-a-rise"
              style={{
                left: x + TILE_W / 2 - 9,
                top: y + 26,
                ...(who === 'You' ? {} : { background: 'var(--cal-lp-border-strong)', color: 'var(--cal-lp-text)' }),
                ['--d' as string]: d,
                ['--t' as string]: '6s',
              }}
            >
              {who[0]}
            </span>
            <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: x + 9, top: y + TILE_H - 15, fontSize: 8.5, ['--d' as string]: d, ['--t' as string]: '6s' }}>
              {who}
            </span>
          </span>
        );
      })}

      {/* The active speaker's mic, in Ana's tile. */}
      {[0, 1, 2, 3].map((i) => (
        <span
          key={`m${i}`}
          className="cal-lp-a-box cal-lp-a-blink"
          style={{
            left: GRID_X + TILE_W - 34 + i * 6,
            top: GRID_Y + TILE_H - 22 - (i % 2) * 4,
            width: 3,
            height: 9 + (i % 2) * 8,
            background: 'var(--cal-lp-accent)',
            borderColor: 'transparent',
            ['--d' as string]: `${2.4 + i * 0.1}s`,
            ['--t' as string]: '6s',
          }}
        />
      ))}

      {/* Chat: messages ride the context, like the signalling does. */}
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: GRID_Y + 2 * (TILE_H + 8) + 12 }}>Room chat</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: 20, top: GRID_Y + 2 * (TILE_H + 8) + 30, fontSize: 8.5, ['--d' as string]: '3.0s', ['--t' as string]: '6s' }}>
        Marko: dropping the release notes in the folder
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: 20, top: GRID_Y + 2 * (TILE_H + 8) + 44, fontSize: 8.5, ['--d' as string]: '4.0s', ['--t' as string]: '6s' }}>
        Iva: can you share your screen?
      </span>

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 4, fontSize: 8.5 }}>
        Signalling rides your nodes · audio and video go direct, and are never stored
      </span>
    </div>
  );
}
