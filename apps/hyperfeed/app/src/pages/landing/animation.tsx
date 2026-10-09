/**
 * Hyperfeed — a minimal mock of the feed itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels and the four beats `/preview` captions: a mention arrives,
 * the agent's own action is logged, the agent proposes instead of acting where
 * your rules say ask, and your pick is carried out in the same chain.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

const rise = (d: string) => ({ ['--d' as string]: d, ['--t' as string]: '7s' });

/** One feed card: a box, a monogram, who did it, and what. */
function Row({ top, d, letters, color, who, title, height = 46 }: {
  top: number;
  d: string;
  letters: string;
  color: string;
  who: string;
  title: string;
  height?: number;
}) {
  return (
    <span>
      <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 20, top, right: 20, height, ...rise(d) }} />
      <span className="cal-lp-a-av cal-lp-a-rise" style={{ left: 30, top: top + 9, background: color, color: '#fff', ...rise(d) }}>
        {letters}
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: 58, top: top + 7, fontSize: 7.5, ...rise(d) }}>
        {who}
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: 58, top: top + 19, fontSize: 10, ...rise(d) }}>
        {title}
      </span>
    </span>
  );
}

export default function HyperfeedAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 12 }}>Your feed · Today</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 12 }}>2 need you</span>

      {/* A mention arrives, answerable in place. */}
      <Row top={32} d="0.3s" letters="Ch" color="#2f4be0" who="Maya · in Chat · #launch" title="Can your agent pull the numbers?" />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ right: 32, top: 39, fontSize: 7.5, ...rise('0.3s') }}>
        Reply in #launch
      </span>

      {/* What the agent did where your rules let it act. */}
      <Row top={86} d="1.1s" letters="Ch" color="#2f4be0" who="Your agent · in Chat · #eng-standup" title="Posted your stand-up" />
      <span className="cal-lp-a-txt cal-lp-a-txt--accent cal-lp-a-rise" style={{ right: 32, top: 93, fontSize: 8, ...rise('1.1s') }}>
        ✓ Done
      </span>

      {/* Where the rules say ask: a proposal with two slots. */}
      <Row top={140} d="2s" letters="Ca" color="#6e2c91" who="Your agent · in Calendar · because Maya asked" title="Book 20 minutes with Maya" height={74} />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ right: 32, top: 147, fontSize: 8, ...rise('2s') }}>
        Waiting for you
      </span>
      {['Today 12:30', 'Today 13:15'].map((slot, i) => (
        <span key={slot}>
          <span
            className="cal-lp-a-box cal-lp-a-rise"
            style={{ left: 58 + i * 84, top: 186, width: 76, height: 18, borderRadius: 9, ...rise('2.4s') }}
          />
          <span className="cal-lp-a-txt cal-lp-a-rise" style={{ left: 58 + i * 84, top: 190, width: 76, textAlign: 'center', fontSize: 8, ...rise('2.4s') }}>
            {slot}
          </span>
        </span>
      ))}

      {/* You pick one; the agent carries it out in the same chain. */}
      <span
        className="cal-lp-a-box cal-lp-a-rise"
        style={{ left: 142, top: 186, width: 76, height: 18, borderRadius: 9, background: 'var(--cal-lp-accent)', borderColor: 'transparent', ...rise('3.6s') }}
      />
      <span className="cal-lp-a-txt cal-lp-a-rise" style={{ left: 142, top: 190, width: 76, textAlign: 'center', fontSize: 8, fontWeight: 650, color: 'var(--cal-lp-accent-text)', ...rise('3.6s') }}>
        Today 13:15
      </span>
      <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 40, top: 222, right: 20, height: 30, ...rise('4.4s') }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: 52, top: 227, fontSize: 7.5, ...rise('4.4s') }}>
        You picked “Today 13:15” · then your agent
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent cal-lp-a-rise" style={{ left: 52, top: 239, fontSize: 9, ...rise('4.4s') }}>
        ✓ Booked Today 13:15 with Maya
      </span>

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, top: 316, fontSize: 8.5 }}>
        Chat: act · Calendar: ask first · Sign: always asks · agent running
      </span>
    </div>
  );
}
