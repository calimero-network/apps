/**
 * Mero Calendar — the hero animation: the app's own week view.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * ⚠️ WHAT WAS WRONG BEFORE
 * Five grey rounded columns with a few tinted chips in them. Two concrete
 * problems and one general one:
 *   • it used a fixed 62px column and only five of them, so the picture stopped
 *     two thirds of the way across the stage and the rest was empty;
 *   • the labels were SIBLINGS of the chips rather than children, so nothing
 *     clipped them — "Design review" ran out of its own box and across the next
 *     day's column;
 *   • it did not look like Mero Calendar. The app is a Google-Calendar-shaped
 *     week view and the hero showed something with no hours, no dates and no
 *     grid, which is the one thing a calendar cannot be missing.
 *
 * WHAT IT MIRRORS NOW, and where each piece comes from in the app:
 *   • `components/calendar/.../navigation` — uppercase letter-spaced day name
 *     over a large date number, today's in a filled accent circle;
 *   • `.../sidebar` — a time gutter of hour labels, the first one blank;
 *   • `.../day` — columns divided by a hairline, one hairline per hour;
 *   • `.../event` — a SOLID accent chip with a hairline border, its title
 *     ellipsised and the time under it;
 *   • `.../time-line` — the red now-line with a dot on the gutter edge.
 *
 * ⚠️ THE CHIP OWNS ITS LABEL. Every label here is a CHILD of its chip, in a
 * flex box with `overflow: hidden`, so a longer event name can only ever be
 * ellipsised. Siblings positioned in literal pixels are what let the old one
 * overflow, and picking shorter words would have hidden the bug rather than
 * fixed it.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

/* ── The grid ───────────────────────────────────────────────────────────
   Sized to FILL the stage: the gutter takes a fixed 32px and the five days
   share everything left over, rather than each taking a fixed width and
   leaving the remainder blank. */
const X0 = 20;
const X1 = 475;
const GUTTER = 32;
const COL_X = X0 + GUTTER;
const COL_W = (X1 - COL_X) / 5;

const GRID_TOP = 84;
const GRID_BOTTOM = 308;
/** The working day the view is cropped to, and how tall an hour is. */
const HOUR_FROM = 9;
const HOUR_TO = 17;
const HOUR_H = (GRID_BOTTOM - GRID_TOP) / (HOUR_TO - HOUR_FROM);

/** y for a wall-clock time, e.g. 13.5 = 13:30. */
const atTime = (h: number) => GRID_TOP + (h - HOUR_FROM) * HOUR_H;

const DAYS = [
  { name: 'Mon', date: 15 },
  { name: 'Tue', date: 16 },
  { name: 'Wed', date: 17 },
  { name: 'Thu', date: 18 },
  { name: 'Fri', date: 19 },
];
/** Wednesday, matching `checkIsToday` in the app's navigation component. */
const TODAY = 2;

/** The red now-line sits where the app would put it: at the actual time. */
const NOW = 13.4;

interface Event {
  col: number;
  from: number;
  to: number;
  title: string;
  /** `#[app::private]` — stored on your node and never replicated. */
  priv?: boolean;
  d: string;
}

const EVENTS: Event[] = [
  { col: 0, from: 9.5, to: 10, title: 'Standup', d: '0.4s' },
  { col: 0, from: 14, to: 15.5, title: 'Roadmap review', d: '2.6s' },
  { col: 1, from: 11, to: 12, title: 'Pairing', d: '1.2s' },
  { col: 2, from: 10, to: 11.5, title: 'Design review', d: '0.8s' },
  { col: 2, from: 15, to: 16, title: 'Release sync', d: '3.2s' },
  { col: 3, from: 13, to: 15, title: 'Focus block', priv: true, d: '1.8s' },
  { col: 4, from: 9, to: 10, title: 'Retro', d: '2.2s' },
  { col: 4, from: 12.5, to: 13.5, title: '1:1 with Ana', d: '1.5s' },
];

/** "13:30", the way the app's sidebar and event rows format a time. */
const clock = (h: number) =>
  `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/** The app's --danger, blended into the page so it works in both themes. */
const NOW_RED = 'color-mix(in srgb, #ff5d6c 88%, var(--cal-lp-bg-1))';

export default function CalendarAnimation() {
  const hours = Array.from({ length: HOUR_TO - HOUR_FROM + 1 }, (_, i) => HOUR_FROM + i);

  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>
        This week · September
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>
        Team · 4 members
      </span>

      {/* Today's column, tinted the way --mc-today-bg tints it in the app. */}
      <span
        className="cal-lp-a-pane"
        style={{
          left: COL_X + TODAY * COL_W,
          top: GRID_TOP - 52,
          width: COL_W,
          height: GRID_BOTTOM - GRID_TOP + 52,
          borderRadius: 6,
          border: 'none',
          background: 'var(--cal-lp-accent-soft)',
        }}
      />

      {/* ── Day header: name over date, today's date in a filled circle ── */}
      {DAYS.map((day, i) => (
        <span key={day.name}>
          <span
            className="cal-lp-a-txt cal-lp-a-txt--head"
            style={{
              left: COL_X + i * COL_W,
              top: GRID_TOP - 46,
              width: COL_W,
              textAlign: 'center',
              fontSize: 8,
              color: i === TODAY ? 'var(--cal-lp-accent-ink)' : undefined,
            }}
          >
            {day.name}
          </span>
          <span
            className={i === TODAY ? 'cal-lp-a-av' : 'cal-lp-a-txt cal-lp-a-txt--val'}
            style={
              i === TODAY
                ? { left: COL_X + i * COL_W + COL_W / 2 - 9, top: GRID_TOP - 33, fontSize: 11 }
                : {
                    left: COL_X + i * COL_W,
                    top: GRID_TOP - 30,
                    width: COL_W,
                    textAlign: 'center',
                    fontSize: 13,
                  }
            }
          >
            {day.date}
          </span>
        </span>
      ))}

      {/* ── The grid: an hour line across, a hairline between days ── */}
      {hours.map((h) => (
        <span key={h}>
          <span
            className="cal-lp-a-line"
            style={{ left: COL_X, top: atTime(h), width: X1 - COL_X, height: 1, opacity: 0.7 }}
          />
          {/* The app's sidebar blanks its first slot because that slot is
              midnight. This view is cropped to office hours, so the first row
              is 09:00 and blanking it would just lose a label. */}
          <span
            className="cal-lp-a-txt cal-lp-a-txt--dim"
            style={{
              left: X0,
              top: atTime(h) - 4,
              width: GUTTER - 6,
              textAlign: 'right',
              fontSize: 8,
            }}
          >
            {clock(h)}
          </span>
        </span>
      ))}
      {DAYS.map((day, i) => (
        <span
          key={`v${day.name}`}
          className="cal-lp-a-line"
          style={{
            left: COL_X + i * COL_W,
            top: GRID_TOP,
            width: 1,
            height: GRID_BOTTOM - GRID_TOP,
            opacity: 0.7,
          }}
        />
      ))}

      {/* ── Events. The label is a CHILD of the chip, so it cannot escape it. ── */}
      {EVENTS.map((e) => {
        const top = atTime(e.from);
        const height = (e.to - e.from) * HOUR_H;
        return (
          <span
            key={`${e.col}-${e.title}`}
            className="cal-lp-a-box cal-lp-a-rise"
            style={{
              left: COL_X + e.col * COL_W + 3,
              top,
              width: COL_W - 8,
              height,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 2,
              overflow: 'hidden',
              padding: '0 5px',
              borderRadius: 4,
              background: e.priv ? 'transparent' : 'var(--cal-lp-accent)',
              borderColor: e.priv ? 'var(--cal-lp-border-strong)' : 'var(--cal-lp-bg-1)',
              borderStyle: e.priv ? 'dashed' : 'solid',
              ['--d' as string]: e.d,
              ['--t' as string]: '6s',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--cal-lp-font)',
                fontSize: 8.5,
                fontWeight: 650,
                lineHeight: 1.1,
                color: e.priv ? 'var(--cal-lp-text-dim)' : 'var(--cal-lp-accent-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {e.title}
            </span>
            {height >= 26 && (
              <span
                style={{
                  fontFamily: 'var(--cal-lp-font)',
                  fontSize: 7.5,
                  lineHeight: 1,
                  color: e.priv ? 'var(--cal-lp-text-faint)' : 'var(--cal-lp-accent-text)',
                  opacity: e.priv ? 1 : 0.75,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {clock(e.from)}–{clock(e.to)}
              </span>
            )}
          </span>
        );
      })}

      {/* ── The now-line, straight out of the app's TimeLine component ── */}
      <span
        className="cal-lp-a-line"
        style={{ left: COL_X - 4, top: atTime(NOW), width: X1 - COL_X + 4, height: 1.5, background: NOW_RED }}
      />
      <span
        className="cal-lp-a-dot"
        style={{ left: COL_X - 7, top: atTime(NOW) - 2, width: 5, height: 5, background: NOW_RED }}
      />

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 2, fontSize: 8.5 }}>
        Dashed = private, never replicated
      </span>
    </div>
  );
}
