/**
 * Mero Chat — the hero: a small chat you can actually use, not a loop to watch.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * At toy scale it behaves like the real app:
 *   - Three channels (one private) and a DM, each with its own conversation —
 *     in the app every channel is its own context, so switching is switching
 *     contexts, not filtering one list.
 *   - Type and press Enter (or the send button): your message lands at once, a
 *     teammate starts typing, and a reply arrives "from her node".
 *   - Click a reaction to add yours, and again to take it back.
 *   - With nobody clicking, the team keeps talking on a gentle loop, so the page
 *     shows live chat even untouched. Under `prefers-reduced-motion` the loop is
 *     off; everything stays interactive.
 *
 * Coordinates are literal pixels against the fixed 495x341 box (STAGE_DESIGN_W
 * in LandingPage.tsx); the template scales the whole box to the stage. Colours
 * are `--cal-lp-*` tokens only, so it follows the page's light/dark theme.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';

type ChannelId = 'general' | 'design' | 'leadership' | 'ada';

interface Msg {
  id: number;
  who: string;
  text: string;
  reactions: Record<string, { n: number; mine: boolean }>;
}

const CHANNELS: { id: ChannelId; label: string; kind: 'public' | 'private' | 'dm' }[] = [
  { id: 'general', label: 'general', kind: 'public' },
  { id: 'design', label: 'design', kind: 'public' },
  { id: 'leadership', label: 'leadership', kind: 'private' },
  { id: 'ada', label: 'Ada Mensah', kind: 'dm' },
];

const PEOPLE: Record<string, { initials: string; tint: string }> = {
  Ada: { initials: 'AM', tint: 'var(--cal-lp-accent-soft)' },
  Theo: { initials: 'TB', tint: 'var(--cal-lp-bg-2)' },
  Priya: { initials: 'PN', tint: 'var(--cal-lp-bg-2)' },
  You: { initials: 'YO', tint: 'var(--cal-lp-accent)' },
};

let nextId = 1;
const m = (who: string, text: string, reactions: Record<string, number> = {}): Msg => ({
  id: nextId++,
  who,
  text,
  reactions: Object.fromEntries(Object.entries(reactions).map(([e, n]) => [e, { n, mine: false }])),
});

const START: Record<ChannelId, Msg[]> = {
  general: [
    m('Theo', 'RC1 is building. TestFlight link in an hour.', { '🚀': 3 }),
    m('Priya', 'Legal signed off on the privacy page 🎉', { '🎉': 4, '👍': 2 }),
    m('Ada', 'Tuesday works for design. Moving the social posts.', { '👍': 1 }),
  ],
  design: [
    m('Ada', 'New onboarding screens are up for review.', { '👀': 2 }),
    m('Theo', 'The empty state looks great in dark mode.'),
  ],
  leadership: [
    m('Priya', 'Hiring plan for Q4 is in the doc. Only this channel can see it.', { '👍': 1 }),
  ],
  ada: [m('Ada', 'Got a sec to look at the launch banner?')],
};

/** What a teammate says back, per channel, in order. */
const REPLIES: Record<ChannelId, { who: string; text: string }[]> = {
  general: [
    { who: 'Ada', text: 'Nice, thanks!' },
    { who: 'Theo', text: 'On it 👍' },
    { who: 'Priya', text: 'Love it.' },
  ],
  design: [
    { who: 'Ada', text: 'Good call, I’ll update the frame.' },
    { who: 'Theo', text: 'Agreed.' },
  ],
  leadership: [{ who: 'Priya', text: 'Noted, let’s decide Friday.' }],
  ada: [
    { who: 'Ada', text: 'Perfect, sending it over now.' },
    { who: 'Ada', text: '🙌' },
  ],
};

/** The idle loop: the team keeps talking in #general when nobody clicks. */
const IDLE: { who: string; text: string }[] = [
  { who: 'Ada', text: 'Banner is final, it’s in #design.' },
  { who: 'Theo', text: 'Android build is in review ✅' },
  { who: 'Priya', text: 'Launch notes go out Tuesday 9am.' },
];

const REACTABLE = ['👍', '🎉'];
const VISIBLE = 4;

const box: CSSProperties = { position: 'absolute', boxSizing: 'border-box' };
const reset: CSSProperties = {
  font: 'inherit',
  color: 'inherit',
  background: 'none',
  border: 0,
  padding: 0,
  margin: 0,
  cursor: 'pointer',
};

function Avatar({ who }: { who: string }) {
  const p = PEOPLE[who] ?? PEOPLE.Theo;
  return (
    <span
      aria-hidden="true"
      style={{
        flex: '0 0 auto',
        width: 22,
        height: 22,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        fontSize: 8.5,
        fontWeight: 700,
        background: p.tint,
        color: who === 'You' ? 'var(--cal-lp-accent-ink)' : 'var(--cal-lp-text)',
        border: '1px solid var(--cal-lp-border)',
      }}
    >
      {p.initials}
    </span>
  );
}

export default function ChatAnimation() {
  const reduced =
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [channel, setChannel] = useState<ChannelId>('general');
  const [msgs, setMsgs] = useState<Record<ChannelId, Msg[]>>(START);
  const [typing, setTyping] = useState<{ channel: ChannelId; who: string } | null>(null);
  const [unread, setUnread] = useState<Partial<Record<ChannelId, number>>>({ design: 1 });
  const [draft, setDraft] = useState('');
  const touched = useRef(false);
  const replyIdx = useRef<Record<string, number>>({});
  const idleIdx = useRef(0);
  const timers = useRef<number[]>([]);
  const channelRef = useRef(channel);
  channelRef.current = channel;

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const post = useCallback((ch: ChannelId, who: string, text: string) => {
    setMsgs((prev) => ({ ...prev, [ch]: [...prev[ch], m(who, text)] }));
    if (ch !== channelRef.current) setUnread((u) => ({ ...u, [ch]: (u[ch] ?? 0) + 1 }));
  }, []);

  /** A teammate types for a moment, then their message arrives. */
  const teammateSays = useCallback(
    (ch: ChannelId, who: string, text: string, typeMs = 1300) => {
      later(500, () => setTyping({ channel: ch, who }));
      later(500 + typeMs, () => {
        setTyping((t) => (t?.channel === ch ? null : t));
        post(ch, who, text);
      });
    },
    [later, post],
  );

  // The idle loop — only until the visitor does something, and never under
  // reduced motion.
  useEffect(() => {
    if (reduced) return;
    const tick = window.setInterval(() => {
      if (touched.current || idleIdx.current >= IDLE.length) return;
      const line = IDLE[idleIdx.current++];
      teammateSays('general', line.who, line.text, 1600);
    }, 5200);
    return () => window.clearInterval(tick);
  }, [reduced, teammateSays]);

  const open = (ch: ChannelId) => {
    touched.current = true;
    setChannel(ch);
    setUnread((u) => ({ ...u, [ch]: 0 }));
  };

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    touched.current = true;
    const ch = channel;
    post(ch, 'You', text.slice(0, 120));
    setDraft('');
    const list = REPLIES[ch];
    const i = replyIdx.current[ch] ?? 0;
    replyIdx.current[ch] = i + 1;
    const reply = list[i % list.length];
    teammateSays(ch, reply.who, reply.text);
  };

  const react = (ch: ChannelId, id: number, emoji: string) => {
    touched.current = true;
    setMsgs((prev) => ({
      ...prev,
      [ch]: prev[ch].map((x) => {
        if (x.id !== id) return x;
        const cur = x.reactions[emoji] ?? { n: 0, mine: false };
        const next = cur.mine ? { n: cur.n - 1, mine: false } : { n: cur.n + 1, mine: true };
        const reactions = { ...x.reactions };
        if (next.n <= 0) delete reactions[emoji];
        else reactions[emoji] = next;
        return { ...x, reactions };
      }),
    }));
  };

  const current = CHANNELS.find((c) => c.id === channel)!;
  const shown = msgs[channel].slice(-VISIBLE);
  const label = current.kind === 'dm' ? current.label : `#${current.label}`;

  return (
    <div className="cal-lp-a" style={{ padding: 0, fontFamily: 'var(--cal-lp-font)', color: 'var(--cal-lp-text)' }}>
      {/* Sidebar */}
      <nav
        aria-label="Channels"
        style={{
          ...box,
          left: 0,
          top: 0,
          bottom: 0,
          width: 128,
          padding: '12px 8px',
          background: 'var(--cal-lp-bg-2)',
          borderRight: '1px solid var(--cal-lp-border)',
          fontSize: 11,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 12, padding: '0 6px 10px' }}>Northwind</div>
        {(['Channels', 'Direct messages'] as const).map((section) => (
          <div key={section} style={{ marginBottom: 8 }}>
            <div
              style={{
                fontSize: 8.5,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--cal-lp-text-faint)',
                padding: '0 6px 4px',
              }}
            >
              {section}
            </div>
            {CHANNELS.filter((c) => (section === 'Channels' ? c.kind !== 'dm' : c.kind === 'dm')).map((c) => {
              const active = c.id === channel;
              const n = unread[c.id] ?? 0;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => open(c.id)}
                  aria-current={active ? 'true' : undefined}
                  aria-label={`${c.kind === 'dm' ? 'Direct message with' : c.kind === 'private' ? 'Private channel' : 'Channel'} ${c.label}${n ? `, ${n} unread` : ''}`}
                  style={{
                    ...reset,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    width: '100%',
                    padding: '4px 6px',
                    borderRadius: 5,
                    fontSize: 11,
                    fontWeight: active || n ? 600 : 400,
                    color: active ? 'var(--cal-lp-text)' : 'var(--cal-lp-text-dim)',
                    background: active ? 'var(--cal-lp-accent-soft)' : 'transparent',
                    textAlign: 'left',
                  }}
                >
                  <span aria-hidden="true" style={{ width: 10, color: 'var(--cal-lp-text-faint)', fontSize: 10 }}>
                    {c.kind === 'public' ? '#' : c.kind === 'private' ? '🔒' : '●'}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.label}
                  </span>
                  {n > 0 && (
                    <span
                      style={{
                        fontSize: 8.5,
                        minWidth: 14,
                        padding: '1px 4px',
                        borderRadius: 7,
                        textAlign: 'center',
                        background: 'var(--cal-lp-accent)',
                        color: 'var(--cal-lp-accent-ink)',
                      }}
                    >
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Header */}
      <div
        style={{
          ...box,
          left: 128,
          right: 0,
          top: 0,
          height: 34,
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderBottom: '1px solid var(--cal-lp-border)',
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {label}
        {current.kind === 'private' && (
          <span
            style={{
              fontSize: 8.5,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 8,
              background: 'var(--cal-lp-bg-2)',
              color: 'var(--cal-lp-text-dim)',
            }}
          >
            private
          </span>
        )}
      </div>

      {/* Messages */}
      <ol
        aria-label={`Messages in ${label}`}
        aria-live="polite"
        style={{
          ...box,
          left: 128,
          right: 0,
          top: 34,
          bottom: 62,
          margin: 0,
          padding: '6px 12px',
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          gap: 7,
          overflow: 'hidden',
        }}
      >
        {shown.map((x) => (
          <li key={x.id} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
            <Avatar who={x.who} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, lineHeight: '13px' }}>
                {x.who === 'You' ? 'You' : x.who}
              </div>
              <div
                style={{
                  fontSize: 11,
                  lineHeight: '14px',
                  color: 'var(--cal-lp-text)',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {x.text}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                {[...new Set([...Object.keys(x.reactions), ...REACTABLE])].map((emoji) => {
                  const r = x.reactions[emoji];
                  if (!r && !REACTABLE.includes(emoji)) return null;
                  return (
                    <button
                      key={emoji}
                      type="button"
                      aria-pressed={!!r?.mine}
                      aria-label={`${r?.mine ? 'Remove' : 'Add'} ${emoji} reaction${r ? `, ${r.n} so far` : ''}`}
                      onClick={() => react(channel, x.id, emoji)}
                      style={{
                        ...reset,
                        fontSize: 9.5,
                        lineHeight: '14px',
                        padding: '1px 6px',
                        borderRadius: 8,
                        border: `1px solid ${r?.mine ? 'var(--cal-lp-accent)' : 'var(--cal-lp-border)'}`,
                        background: r?.mine ? 'var(--cal-lp-accent-soft)' : r ? 'var(--cal-lp-bg-2)' : 'transparent',
                        opacity: r ? 1 : 0.55,
                      }}
                    >
                      {emoji}
                      {r ? ` ${r.n}` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* Typing indicator */}
      <div
        aria-live="polite"
        style={{ ...box, left: 140, right: 12, bottom: 46, height: 14, fontSize: 9.5, color: 'var(--cal-lp-text-dim)', fontStyle: 'italic' }}
      >
        {typing?.channel === channel ? `${typing.who} is typing…` : ''}
      </div>

      {/* Composer */}
      <form
        onSubmit={send}
        style={{
          ...box,
          left: 140,
          right: 12,
          bottom: 10,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 4px 0 10px',
          borderRadius: 8,
          border: '1px solid var(--cal-lp-border-strong)',
          background: 'var(--cal-lp-bg-1)',
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => (touched.current = true)}
          placeholder={`Message ${label}`}
          aria-label={`Message ${label}`}
          maxLength={120}
          style={{
            flex: 1,
            minWidth: 0,
            font: 'inherit',
            fontSize: 11,
            color: 'var(--cal-lp-text)',
            background: 'transparent',
            border: 0,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={!draft.trim()}
          style={{
            ...reset,
            width: 24,
            height: 24,
            borderRadius: 6,
            display: 'grid',
            placeItems: 'center',
            background: draft.trim() ? 'var(--cal-lp-accent)' : 'var(--cal-lp-bg-2)',
            color: draft.trim() ? 'var(--cal-lp-accent-ink)' : 'var(--cal-lp-text-faint)',
            cursor: draft.trim() ? 'pointer' : 'default',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </div>
  );
}
