/**
 * Mero Forms — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * The real thing in three beats: a form being answered on the left, the
 * response arriving at the top of the list on the right, and one response
 * going on to Mero CRM. Real labels, because "Name / Email / Topic" says what
 * the app is for and a grey rectangle does not.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

const FORM_X = 20;
const FORM_W = 200;
const LIST_X = 236;
const LIST_W = 239;
const ROW_H = 34;
const ROWS_TOP = 70;

const FIELDS: { label: string; value: string; top: number; d: string }[] = [
  { label: 'Name', value: 'Ada Lovelace', top: 66, d: '0s' },
  { label: 'Email', value: 'ada@analytical.io', top: 112, d: '0.6s' },
];

const ROWS: [string, string, string][] = [
  ['Grace Hopper', 'Desktop', 'In CRM'],
  ['Alan Turing', 'Cloud', 'New'],
  ['Katherine Johnson', 'Cloud', 'New'],
];

export default function FormsAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      {/* The form, as a respondent sees it. */}
      <span className="cal-lp-a-pane" style={{ left: FORM_X, top: 16, width: FORM_W, bottom: 22 }} />
      <span
        className="cal-lp-a-box"
        style={{ left: FORM_X, top: 16, width: FORM_W, height: 4, borderRadius: '8px 8px 0 0', background: 'var(--cal-lp-accent)', borderColor: 'transparent' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: FORM_X + 14, top: 32, fontSize: 13 }}>Contact us</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: FORM_X + 14, top: 50, fontSize: 8.5 }}>* Required</span>

      {FIELDS.map((f) => (
        <span key={f.label}>
          <span className="cal-lp-a-txt" style={{ left: FORM_X + 14, top: f.top, fontSize: 9, fontWeight: 650 }}>
            {f.label} <span style={{ color: 'var(--cal-lp-accent-ink)' }}>*</span>
          </span>
          <span
            className="cal-lp-a-box cal-lp-a-flash"
            style={{ left: FORM_X + 14, top: f.top + 14, width: FORM_W - 28, height: 22, ['--d' as string]: f.d, ['--t' as string]: '6s' }}
          />
          <span
            className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-in"
            style={{ left: FORM_X + 22, top: f.top + 21, fontSize: 9.5, ['--d' as string]: f.d, ['--t' as string]: '6s' }}
          >
            {f.value}
          </span>
        </span>
      ))}

      <span className="cal-lp-a-txt" style={{ left: FORM_X + 14, top: 160, fontSize: 9, fontWeight: 650 }}>
        Topic <span style={{ color: 'var(--cal-lp-accent-ink)' }}>*</span>
      </span>
      {['Cloud', 'Desktop', 'Other'].map((o, i) => (
        <span key={o}>
          <span
            className="cal-lp-a-dot"
            style={{
              left: FORM_X + 16,
              top: 178 + i * 18,
              width: 10,
              height: 10,
              background: i === 0 ? 'var(--cal-lp-accent)' : 'transparent',
              border: '2px solid var(--cal-lp-border-strong)',
              boxSizing: 'border-box',
            }}
          />
          <span className="cal-lp-a-txt" style={{ left: FORM_X + 32, top: 179 + i * 18, fontSize: 9.5 }}>{o}</span>
        </span>
      ))}

      <span
        className="cal-lp-a-chip cal-lp-a-blink"
        style={{ left: FORM_X + 14, top: 246, background: 'var(--cal-lp-accent)', color: 'var(--cal-lp-accent-text)', ['--d' as string]: '1.4s', ['--t' as string]: '6s' }}
      >
        Submit
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: FORM_X + 14, bottom: 30, fontSize: 8, width: FORM_W - 28, whiteSpace: 'normal', lineHeight: 1.35 }}>
        From your website, with a key that can answer this form and nothing else
      </span>

      {/* The responses, as the team sees them. */}
      <span className="cal-lp-a-pane" style={{ left: LIST_X, top: 16, width: LIST_W, bottom: 22 }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: LIST_X + 12, top: 28 }}>Responses</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 32, top: 28, fontSize: 9 }}>4 · 2 new</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: LIST_X + 12, top: 48, fontSize: 8 }}>Topic</span>
      <span className="cal-lp-a-box" style={{ left: LIST_X + 44, top: 47, width: 108, height: 7, borderRadius: 4 }} />
      <span className="cal-lp-a-box cal-lp-a-grow" style={{ left: LIST_X + 44, top: 47, width: 72, height: 7, borderRadius: 4, background: 'var(--cal-lp-accent)', borderColor: 'transparent', transformOrigin: 'left', ['--d' as string]: '2s', ['--t' as string]: '6s' }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: LIST_X + 158, top: 47, fontSize: 8 }}>Cloud 3 · Desktop 1</span>

      {/* The new one, arriving at the top. */}
      <span
        className="cal-lp-a-box cal-lp-a-rise"
        style={{ left: LIST_X + 10, top: ROWS_TOP, width: LIST_W - 20, height: ROW_H - 6, background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent', ['--d' as string]: '1.8s', ['--t' as string]: '6s' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: LIST_X + 20, top: ROWS_TOP + 10, fontSize: 9.5, ['--d' as string]: '1.8s', ['--t' as string]: '6s' }}>
        Ada Lovelace
      </span>
      <span className="cal-lp-a-txt cal-lp-a-rise" style={{ left: LIST_X + 118, top: ROWS_TOP + 10, fontSize: 9, ['--d' as string]: '1.8s', ['--t' as string]: '6s' }}>
        Cloud
      </span>
      <span className="cal-lp-a-chip cal-lp-a-rise" style={{ left: LIST_X + 172, top: ROWS_TOP + 6, fontSize: 8.5, padding: '2px 7px', ['--d' as string]: '1.8s', ['--t' as string]: '6s' }}>
        New
      </span>

      {ROWS.map(([name, topic, status], i) => (
        <span key={name}>
          <span className="cal-lp-a-box" style={{ left: LIST_X + 10, top: ROWS_TOP + (i + 1) * ROW_H, width: LIST_W - 20, height: ROW_H - 6 }} />
          <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: LIST_X + 20, top: ROWS_TOP + 10 + (i + 1) * ROW_H, fontSize: 9.5 }}>{name}</span>
          <span className="cal-lp-a-txt" style={{ left: LIST_X + 118, top: ROWS_TOP + 10 + (i + 1) * ROW_H, fontSize: 9 }}>{topic}</span>
          <span
            className={status === 'In CRM' ? 'cal-lp-a-chip cal-lp-a-flash' : 'cal-lp-a-chip'}
            style={{
              left: LIST_X + 172,
              top: ROWS_TOP + 6 + (i + 1) * ROW_H,
              fontSize: 8.5,
              padding: '2px 7px',
              ...(status === 'In CRM'
                ? { background: 'var(--cal-lp-accent)', color: 'var(--cal-lp-accent-text)', ['--d' as string]: '3.2s', ['--t' as string]: '6s' }
                : {}),
            }}
          >
            {status}
          </span>
        </span>
      ))}

      {/* The hand-off. */}
      <span
        className="cal-lp-a-chip cal-lp-a-in"
        style={{ left: LIST_X + 10, top: ROWS_TOP + 4 * ROW_H + 10, ['--d' as string]: '3.2s', ['--t' as string]: '6s' }}
      >
        Send to CRM → contact + deal
      </span>
      <span className="cal-lp-a-cursor cal-lp-a-drift" style={{ left: LIST_X + 186, top: ROWS_TOP + 4 * ROW_H + 26, ['--dx' as string]: '10px', ['--dy' as string]: '6px', ['--t' as string]: '6s' }} />
    </div>
  );
}
