/**
 * Mero Forum — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 *
 * ⚠️ Sized to the frame. Three threads and one reply filled half the height and
 * left the frame looking like an empty forum — the opposite of the thing being
 * advertised. Six threads, vote counts and a composer fill it with something
 * that reads as in use.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

type Thread = {
  title: string;
  meta: string;
  votes: number;
  delay: string;
  /** Rendered nested under the thread, as a reply landing. */
  reply?: { who: string; text: string; delay: string };
};

const THREADS: Thread[] = [
  {
    title: 'Should we pin the SDK per app?',
    meta: '7 replies · 2h',
    votes: 12,
    delay: '0.4s',
    reply: { who: 'A', text: 'Agreed — pin it in the catalog.', delay: '3.4s' },
  },
  { title: 'Node keeps dropping on wifi', meta: '3 replies · 5h', votes: 5, delay: '0.9s' },
  { title: 'rc.32 broke our migration', meta: '9 replies · yesterday', votes: 8, delay: '1.4s' },
  { title: 'Invite links expiring too fast?', meta: '2 replies · yesterday', votes: 3, delay: '1.9s' },
  { title: 'Welcome thread', meta: '12 replies · last week', votes: 21, delay: '2.4s' },
];

const ROW_H = 38;
const TOP = 34;

export default function ForumAnimation() {
  const rows: React.ReactNode[] = [];
  let y = TOP;

  THREADS.forEach((t, i) => {
    const d = t.delay;
    rows.push(
      <span key={`t${i}`}>
        <span
          className="cal-lp-a-box cal-lp-a-rise"
          style={{
            left: 20,
            top: y,
            right: 20,
            height: 32,
            ...(i === 0 ? { background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent' } : {}),
            ['--d' as string]: d,
            ['--t' as string]: '6s',
          }}
        />
        {/* The vote tally, in its own gutter — one row per voter per post. */}
        <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: 30, top: y + 7, width: 24, textAlign: 'center', fontSize: 10, ['--d' as string]: d, ['--t' as string]: '6s' }}>
          {t.votes}
        </span>
        <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: 30, top: y + 19, width: 24, textAlign: 'center', fontSize: 7.5, ['--d' as string]: d, ['--t' as string]: '6s' }}>
          votes
        </span>
        <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: 64, top: y + 7, ['--d' as string]: d, ['--t' as string]: '6s' }}>
          {t.title}
        </span>
        <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: 64, top: y + 19, fontSize: 8.5, ['--d' as string]: d, ['--t' as string]: '6s' }}>
          {t.meta}
        </span>
      </span>,
    );
    y += ROW_H;

    if (t.reply) {
      rows.push(
        <span key={`r${i}`}>
          <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 50, top: y, right: 20, height: 26, ['--d' as string]: t.reply.delay, ['--t' as string]: '6s' }} />
          <span className="cal-lp-a-av cal-lp-a-rise" style={{ left: 60, top: y + 5, ['--d' as string]: t.reply.delay, ['--t' as string]: '6s' }}>
            {t.reply.who}
          </span>
          <span className="cal-lp-a-txt cal-lp-a-rise" style={{ left: 84, top: y + 10, fontSize: 8.5, ['--d' as string]: t.reply.delay, ['--t' as string]: '6s' }}>
            {t.reply.text}
          </span>
        </span>,
      );
      y += 32;
    }
  });

  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 12 }}>Engineering</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 12 }}>Invite only · 8 members</span>
      {rows}
      {/* The composer, so the frame ends on "you can write here". */}
      <span className="cal-lp-a-box" style={{ left: 20, top: y + 6, right: 96, height: 24, borderRadius: 6 }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 30, top: y + 14, fontSize: 8.5 }}>Start a thread…</span>
      <span
        className="cal-lp-a-box"
        style={{ left: 405, top: y + 6, width: 70, height: 24, borderRadius: 6, background: 'var(--cal-lp-accent)', borderColor: 'transparent' }}
      />
      <span className="cal-lp-a-txt" style={{ left: 405, top: y + 14, width: 70, textAlign: 'center', fontSize: 9, color: 'var(--cal-lp-accent-text)', fontWeight: 650 }}>
        Post
      </span>
    </div>
  );
}
