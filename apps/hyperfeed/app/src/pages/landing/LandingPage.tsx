import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import "./landing.css";
import { DOWNLOAD, LandingShell, useConnect } from "./chrome";
import { appLook } from "../../apps";
import { BrandMark } from "../../brand";

/**
 * Hyperfeed's front door for signed-out visitors.
 *
 * Hand-owned, like mero-pass's: Hyperfeed left the shared landing template
 * (scripts/landing) for a page in the app's own look. It is told why, then
 * how, then what, for the people who run a team rather than a terminal. Every
 * screen on it draws something the app does today; tests/marketing-landing.spec.ts
 * holds it to that shape.
 */
export default function LandingPage() {
  const { connect, dialog } = useConnect();
  return (
    <LandingShell page="home" connect={connect}>
      <Hero connect={connect} />
      <Why />
      <Features />
      <TryARule />
      <Private />
      <ADay />
      <YourAi />
      <Apps />
      <Questions />
      <Closing connect={connect} />
      {dialog}
    </LandingShell>
  );
}

/** An app's own icon, as the feed shows it. */
function Icon({ app, children }: { app: string; children?: ReactNode }) {
  const look = appLook(app);
  return (
    <span className="hl-ic" aria-hidden="true">
      {look.icon ? <img src={look.icon} alt="" /> : null}
      {children}
    </span>
  );
}

function Window({ title, label, children }: { title: string; label: string; children: ReactNode }) {
  return (
    <div className="hl-window hl-glass" role="img" aria-label={label}>
      <div className="hl-window-bar">
        <i />
        <i />
        <i />
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Row({
  app,
  meta,
  title,
  who,
  tag,
  tone,
  on,
  children,
}: {
  app: string;
  meta: string;
  title: string;
  who?: string;
  tag?: string;
  tone?: "wait" | "good" | "busy";
  on?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`hl-row${on ? " hl-row-on" : ""}`}>
      <Icon app={app} />
      <div>
        <div className="hl-row-meta">{meta}</div>
        <div className="hl-row-title">{title}</div>
        {who && <span className="hl-row-who">{who}</span>}
        {children}
      </div>
      {tag && <span className={`hl-tag hl-tag-${tone ?? "wait"}`}>{tag}</span>}
    </div>
  );
}

const Lock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

const Shield = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3 4 7v5c0 5 3.5 8 8 9 4.5-1 8-4 8-9V7Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

function Hero({ connect }: { connect: () => void }) {
  return (
    <section className="hl-wrap" aria-labelledby="hl-title">
      <div className="hl-hero">
        <span className="hl-eyebrow hl-glass">Your time. Your AI. Your data.</span>
        <h1 id="hl-title" className="hl-h1">
          Get your <span className="hl-grad">attention</span> back.
        </h1>
        <p className="hl-lead">Everything that needs you, in one private feed. Your AI assistants handle the rest, by your rules.</p>
        <div className="hl-ctas">
          <button type="button" className="hl-btn hl-btn-primary" onClick={connect}>
            Open your feed
          </button>
          <Link className="hl-btn hl-btn-ghost" to="/demo">
            Try the demo, no node needed
          </Link>
        </div>
      </div>

      <div className="hl-stage">
        <div className="hl-float hl-float-1 hl-glass" aria-hidden="true">
          <Icon app="crm" />
          <div>
            Deal moved to Negotiation
            <small>Sales assistant · Undo</small>
          </div>
        </div>
        <div className="hl-float hl-float-2 hl-glass" aria-hidden="true">
          <span className="hl-live">Agent live</span>
        </div>
        <div className="hl-float hl-float-3 hl-glass" aria-hidden="true">
          <span style={{ color: "var(--good-ink)", display: "inline-flex" }}>
            <Lock />
          </span>
          <div>
            Stored only on your devices
            <small>No company server</small>
          </div>
        </div>

        <Window title="Hyperfeed — Acme" label="The Hyperfeed app: your feeds and apps, today's items, and a chat request opened with a reply your assistant drafted">
          <div className="hl-app">
            <aside className="hl-side">
              <div>
                <h5>Feeds</h5>
                <div className="hl-side-item on">
                  <BrandMark size={22} />
                  Acme
                </div>
                <div className="hl-side-item" style={{ opacity: 0.6 }}>
                  <BrandMark size={22} />
                  Side project
                </div>
              </div>
              <div>
                <h5>Apps</h5>
                {(
                  [
                    ["chat", "Chat", 2],
                    ["calendar", "Calendar", 1],
                    ["sign", "Sign", 1],
                    ["crm", "CRM", 0],
                    ["docs", "Docs", 0],
                  ] as const
                ).map(([app, name, n]) => (
                  <div key={app} className="hl-side-item">
                    <Icon app={app} />
                    {name}
                    {n > 0 && <em>{n}</em>}
                  </div>
                ))}
              </div>
              <div className="hl-side-status">
                <span className="hl-live">Agent live</span>
                <div>
                  Pause <span className="hl-toggle" />
                </div>
              </div>
            </aside>
            <div className="hl-main">
              <div className="hl-main-top">
                <h4>Today</h4>
                <div className="hl-lanes">
                  <span className="on">
                    To do<b>3</b>
                  </span>
                  <span>
                    In progress<b>2</b>
                  </span>
                  <span>
                    Done<b>14</b>
                  </span>
                </div>
              </div>
              <Row app="chat" meta="Chat · #launch · Maya" title="Can you approve the launch post?" who="Reply drafted" tag="Needs you" on />
              <Row app="sign" meta="Sign · Legal" title="Partner agreement is ready to sign" who="Always asks you" tag="Needs you" />
              <Row app="calendar" meta="Calendar · Leadership" title="Move board prep to Thursday 10:00?" who="Ops assistant" tag="Needs you" />
              <div className="hl-lane-label">In progress</div>
              <Row app="docs" meta="Docs · Q3 plan" title="Summarising the Q3 plan for you" tag="Working" tone="busy" />
              <Row app="sheets" meta="Sheets · Hiring" title="Your answer is on its way to Dev" tag="Sending" tone="busy" />
            </div>
            <div className="hl-detail">
              <div className="hl-detail-head">
                <Icon app="chat" />
                <div>
                  <div className="hl-row-meta">#launch · Maya · 8:02</div>
                  <h4>Can you approve the launch post?</h4>
                </div>
              </div>
              <div className="hl-bubble">“Draft is in Docs. We’d like it live by 10. Anything to change?”</div>
              <div className="hl-draft">
                <small>Drafted by your private assistant</small>
                Looks great. One change: lead with the customer quote. Approved once that’s in.
              </div>
              <div className="hl-acts">
                <span className="hl-fake hl-fake-primary">Send</span>
                <span className="hl-fake">Edit</span>
                <span className="hl-fake">Open in Chat</span>
                <span className="hl-fake">Later</span>
              </div>
              <span className="hl-verified">
                <Shield />
                Private assistant · attested
              </span>
            </div>
          </div>
        </Window>
      </div>
    </section>
  );
}

const NOISE: [string, number, number][] = [
  ["chat", 24, -4],
  ["calendar", 6, 3],
  ["crm", 11, -2],
  ["docs", 9, 5],
  ["sign", 2, 2],
  ["sheets", 14, -5],
  ["issues", 31, 4],
  ["standup", 7, -3],
];

function Why() {
  return (
    <section id="why" className="hl-section hl-wrap">
      <div className="hl-why">
        <div className="hl-noise hl-glass" role="img" aria-label="Eight apps, each with a pile of unread notifications">
          {NOISE.map(([app, n, r]) => (
            <span key={app} style={{ transform: `rotate(${r}deg)` }}>
              <Icon app={app}>
                <b>{n}</b>
              </Icon>
            </span>
          ))}
        </div>
        <div className="hl-stack">
          <span className="hl-eyebrow hl-glass">Why</span>
          <h2 className="hl-h2">The tools meant to save you time are eating it.</h2>
          <ul className="hl-beliefs">
            {[
              "Your day is for decisions, not for checking.",
              "AI should work for you, not for whoever made it.",
              "What happens in your company stays there.",
            ].map((b, i) => (
              <li key={b} className="hl-glass">
                <span>{i + 1}</span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Feature({ flip, kicker, title, body, ticks, children }: { flip?: boolean; kicker: string; title: string; body: string; ticks?: string[]; children: ReactNode }) {
  return (
    <div className={`hl-feat${flip ? " hl-feat-flip" : ""}`}>
      <div className="hl-copy">
        <span className="hl-kicker hl-grad">{kicker}</span>
        <h3 className="hl-h2 hl-h2-md">{title}</h3>
        <p>{body}</p>
        {ticks && (
          <ul className="hl-ticks">
            {ticks.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </div>
      {children}
    </div>
  );
}

const MODES = ["Act", "Ask first", "Read only", "Off"];
const CONTROLS: [string, string, string][] = [
  ["chat", "Chat", "Act"],
  ["calendar", "Calendar", "Ask first"],
  ["sheets", "Sheets", "Read only"],
  ["pass", "Pass", "Off"],
];

function Features() {
  return (
    <section id="features" className="hl-section hl-section-tight hl-wrap">
      <div className="hl-head">
        <span className="hl-eyebrow hl-glass">How it works</span>
        <h2 className="hl-h2">One place. Your rules. Fully private.</h2>
      </div>

      <Feature
        kicker="One feed"
        title="Answer it where it lands."
        body="Messages, approvals, signatures and your assistants’ questions arrive in one place, sorted into to do, in progress and done."
        ticks={["Reply, approve or pick an option in place", "Open the full thread beside the feed", "Put anything away until later"]}
      >
        <Window title="Today" label="Three lanes: a vote and an investor question waiting on you, and a fixed issue">
          <div className="hl-window-body">
            <Row app="vote" meta="Vote · Offsite" title="Lisbon or Porto for the offsite?" tag="Needs you">
              <div className="hl-acts" style={{ marginTop: 8 }}>
                <span className="hl-fake hl-fake-primary">Lisbon</span>
                <span className="hl-fake">Porto</span>
              </div>
            </Row>
            <Row app="updates" meta="Updates · Investors" title="Two investors asked about runway" tag="Needs you" />
            <Row app="issues" meta="Issues · #212" title="Pricing page bug was fixed" tag="Done" tone="good" />
          </div>
        </Window>
      </Feature>

      <Feature
        flip
        kicker="Your rules"
        title="Every assistant on a leash you hold."
        body="For each app, choose how far assistants may go. Important things always come back to you."
        ticks={["Act, ask first, read only, or off", "Money and signing always ask you", "One switch pauses everything"]}
      >
        <Window title="Settings · Controls" label="Controls: what assistants may do in each app, what always asks you, and the pause switch">
          <div className="hl-window-body">
            {CONTROLS.map(([app, name, on]) => (
              <div key={app} className="hl-ctl">
                <Icon app={app} />
                {name}
                <span className="hl-seg">
                  {MODES.map((m) => (
                    <span key={m} className={m === on ? "on" : undefined}>
                      {m}
                    </span>
                  ))}
                </span>
              </div>
            ))}
            <div className="hl-guards">
              Always ask me before
              {["Money", "Signing", "New contacts", "Deleting"].map((g) => (
                <span key={g} className="hl-tag hl-tag-wait">
                  {g}
                </span>
              ))}
            </div>
            <div className="hl-ctl hl-ctl-plain">
              Pause all assistants <span className="hl-toggle" />
            </div>
          </div>
        </Window>
      </Feature>

      <Feature
        kicker="Your assistants"
        title="The right AI for each job."
        body="Give each app the assistant you trust for it. Swap any time, and see who is working right now."
        ticks={["One assistant per app, set by you", "Check a private assistant before you trust it", "Folder-by-folder access on your laptop"]}
      >
        <Window title="Settings · Assistants" label="Your assistants and the apps each one works in">
          <div className="hl-window-body">
            {(
              [
                ["Private assistant", "Sealed machine · attested", ["chat", "docs"], "linear-gradient(135deg,#3e63f5,#8b5cf6)"],
                ["Laptop assistant", "~/Board · read only", ["sheets"], "linear-gradient(135deg,#0ea5e9,#3e63f5)"],
                ["Sales assistant", "Connected for one job", ["crm"], "linear-gradient(135deg,#ec4899,#f59e0b)"],
              ] as const
            ).map(([name, sub, apps, bg]) => (
              <div key={name} className="hl-agent">
                <span style={{ background: bg, color: "#fff" }}>
                  <Shield size={18} />
                </span>
                <div>
                  <b>{name}</b>
                  <small>{sub}</small>
                  <div className="hl-chips">
                    {apps.map((a) => (
                      <span key={a} className="hl-chip">
                        <Icon app={a} />
                        {appLook(a).name}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="hl-live">Live</span>
              </div>
            ))}
          </div>
        </Window>
      </Feature>

      <Feature
        flip
        kicker="Talk to it"
        title="Ask in plain words. Approve in one tap."
        body="Tell your assistant what you need. When it wants to change something, the approval appears right in the conversation."
      >
        <Window title="Chat with your assistant" label="A chat with your assistant, with an approval inside the conversation">
          <div className="hl-chat">
            <div className="hl-msg hl-msg-me">Prep me for tomorrow’s board call.</div>
            <div className="hl-msg hl-msg-bot">
              <small>Private assistant</small>
              Here’s a one-page brief from the Q3 sheet and last week’s investor questions.
              <div className="hl-file">
                <Icon app="docs" />
                Board brief · 1 page
              </div>
            </div>
            <div className="hl-msg hl-msg-bot">
              <small>Private assistant</small>
              Two people clash with board prep on Wednesday.
              <div className="hl-ask">
                Move board prep to Thu 10:00?
                <div className="hl-acts">
                  <span className="hl-fake hl-fake-primary">Approve</span>
                  <span className="hl-fake">Not now</span>
                </div>
              </div>
            </div>
          </div>
          <div className="hl-composer">
            <span>Ask your assistant…</span>
            <span>→</span>
          </div>
        </Window>
      </Feature>

      <Feature
        kicker="Teams"
        title="One thread per task."
        body="The issue, the doc, the chat and what the assistants did come together, with your teammates’ comments in the same place."
      >
        <Window title="Launch v2 pricing" label="A task thread linking an issue, a doc and a chat channel, with teammates' updates">
          <div className="hl-window-body">
            <div className="hl-links-row">
              <span className="hl-chip">
                <Icon app="issues" />
                Issue #212
              </span>
              <span className="hl-chip">
                <Icon app="docs" />
                Pricing spec
              </span>
              <span className="hl-chip">
                <Icon app="chat" />
                #launch
              </span>
              <span className="hl-tag hl-tag-busy">In progress</span>
            </div>
            {(
              [
                ["LK", "#e0637a", "Lena · Issue #212", "Annual plans need a mid-cycle rule. Added to the spec."],
                ["AI", "var(--brand-grad)", "Your assistant · Docs", "Updated the spec and the FAQ to match."],
                ["DO", "#3e63f5", "Dev · #launch", "Pricing page is ready for review."],
              ] as const
            ).map(([ab, bg, who, what]) => (
              <div key={who} className="hl-post">
                <span className="hl-avatar" style={{ background: bg }}>
                  {ab}
                </span>
                <div>
                  <small>{who}</small>
                  {what}
                </div>
              </div>
            ))}
          </div>
        </Window>
      </Feature>

      <div className="hl-minis">
        {(
          [
            ["Undo anything", <>Every assistant action can be reversed.</>, <path key="u" d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />],
            ["Later", <>Put an item away. It comes back on time.</>, <path key="l" d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />],
            ["You choose what shows up", <>Approve what each app can bring in.</>, <path key="e" d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />],
            [
              "Keyboard first",
              <>
                <kbd>J</kbd> <kbd>K</kbd> to move, <kbd>E</kbd> to archive.
              </>,
              <path key="k" d="M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm3 8h8" />,
            ],
          ] as const
        ).map(([title, body, icon]) => (
          <div key={title} className="hl-mini hl-glass">
            <span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {icon}
              </svg>
            </span>
            <b>{title}</b>
            <p>{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const RULE = {
  app: ["CRM", "Calendar", "Chat", "Docs"],
  agent: ["my sales assistant", "my private assistant", "my laptop assistant"],
  mode: ["act on its own", "only suggest", "only look"],
  guard: ["anything with money", "signing anything", "new contacts", "deleting anything"],
};
type RulePart = keyof typeof RULE;

const RESULT = [
  (app: string) => `It works in ${app} by itself. You see every action, and can undo it.`,
  (app: string) => `It prepares changes in ${app}, then waits for your OK.`,
  (app: string) => `It can read ${app} to help you, but never changes anything.`,
];

function TryARule() {
  const [at, setAt] = useState<Record<RulePart, number>>({ app: 0, agent: 0, mode: 0, guard: 0 });
  const pick = (part: RulePart) => (
    <button type="button" className="hl-pick" onClick={() => setAt((s) => ({ ...s, [part]: (s[part] + 1) % RULE[part].length }))}>
      {RULE[part][at[part]]}
    </button>
  );
  return (
    <section id="rules" className="hl-wrap">
      <div className="hl-rule hl-glass">
        <span className="hl-eyebrow hl-glass">Try it</span>
        <p className="hl-sentence">
          In {pick("app")}, {pick("agent")} may {pick("mode")}, but asks me before {pick("guard")}.
        </p>
        <p className="hl-result" aria-live="polite">
          → {RESULT[at.mode]!(RULE.app[at.app]!)}
        </p>
        <p className="hl-hint">Tap the blue words to change the rule.</p>
      </div>
    </section>
  );
}

function Private() {
  return (
    <section id="private" className="hl-section hl-wrap">
      <div className="hl-private">
        <div className="hl-stack">
          <span className="hl-eyebrow hl-glass">Private by default</span>
          <h2 className="hl-h2">We can’t read your feed. Nobody can.</h2>
          <ul className="hl-points">
            <li>Lives on your own node, on your devices</li>
            <li>No Hyperfeed server to leak</li>
            <li>Every AI action on the record</li>
          </ul>
        </div>
        <div className="hl-diagram-card hl-glass">
          <svg className="hl-diagram" viewBox="0 0 520 320" role="img" aria-label="Your laptop, phone and private server sync directly. There is no company cloud in the middle.">
            <defs>
              <linearGradient id="hl-link" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#3e63f5" />
                <stop offset="0.55" stopColor="#8b5cf6" />
                <stop offset="1" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <path d="M214 74a30 30 0 0 1 58-10 24 24 0 0 1 34 22 20 20 0 0 1-4 40h-84a26 26 0 0 1-4-52Z" className="dev" strokeWidth="2" strokeDasharray="4 5" />
            <path d="M240 70l42 42M282 70l-42 42" stroke="#f25f5c" strokeWidth="3.5" strokeLinecap="round" />
            <text x="260" y="146" textAnchor="middle">
              no company cloud
            </text>
            <path d="M120 196 C 190 150, 330 150, 420 196" fill="none" stroke="url(#hl-link)" strokeWidth="2.5" strokeDasharray="6 6" />
            <path d="M150 236 H 232 M288 236 H 376" fill="none" stroke="url(#hl-link)" strokeWidth="2.5" strokeDasharray="6 6" />
            <rect className="dev" x="30" y="196" width="120" height="78" rx="12" />
            <rect className="scr" x="40" y="206" width="100" height="58" rx="6" />
            <rect className="hi" x="48" y="214" width="62" height="8" rx="4" />
            <rect className="ln" x="48" y="230" width="80" height="8" rx="4" />
            <rect className="ln" x="48" y="246" width="54" height="8" rx="4" />
            <rect className="dev" x="16" y="274" width="148" height="10" rx="5" />
            <text x="90" y="306" textAnchor="middle">
              your laptop
            </text>
            <rect className="dev" x="232" y="174" width="56" height="96" rx="13" />
            <rect className="scr" x="240" y="186" width="40" height="72" rx="6" />
            <rect className="hi" x="246" y="194" width="24" height="6" rx="3" />
            <rect className="ln" x="246" y="206" width="28" height="6" rx="3" />
            <rect className="ln" x="246" y="218" width="20" height="6" rx="3" />
            <text x="260" y="292" textAnchor="middle">
              your phone
            </text>
            <rect className="dev" x="376" y="196" width="112" height="34" rx="9" />
            <rect className="dev" x="376" y="236" width="112" height="34" rx="9" />
            <circle cx="396" cy="213" r="5" fill="#22c55e" />
            <circle cx="396" cy="253" r="5" fill="#22c55e" />
            <rect className="ln" x="410" y="209" width="60" height="8" rx="4" />
            <rect className="ln" x="410" y="249" width="44" height="8" rx="4" />
            <text x="432" y="306" textAnchor="middle">
              your private server
            </text>
          </svg>
        </div>
      </div>
    </section>
  );
}

function ADay() {
  return (
    <section id="day" className="hl-section hl-section-tight hl-wrap">
      <div className="hl-head">
        <span className="hl-eyebrow hl-glass">What you get</span>
        <h2 className="hl-h2">A Tuesday, with Hyperfeed.</h2>
      </div>
      <div className="hl-day">
        <div className="hl-slot hl-glass">
          <time className="hl-grad">08:10</time>
          <h3>Three things, done over coffee.</h3>
          <Row app="chat" meta="Drafted for you" title="Reply to investor" />
          <Row app="calendar" meta="Clash on Wed" title="Board prep → Thu" />
        </div>
        <div className="hl-slot hl-glass">
          <time className="hl-grad">11:00</time>
          <h3>You’re in meetings. Your assistants aren’t.</h3>
          <Row app="crm" meta="Sales assistant · Undo" title="Deal moved forward" />
          <Row app="crm" meta="Sales assistant · Undo" title="Call notes saved" />
        </div>
        <div className="hl-slot hl-glass">
          <time className="hl-grad">14:30</time>
          <h3>A contract only you can sign.</h3>
          <Row app="sign" meta="Always comes to you" title="Partner agreement" tag="Sign" />
        </div>
        <div className="hl-slot hl-glass">
          <time className="hl-grad">18:00</time>
          <h3>The whole day, on one page.</h3>
          <div className="hl-row">
            <BrandMark size={28} />
            <div>
              <div className="hl-row-meta">9 by your assistants</div>
              <div className="hl-row-title">23 things done</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function YourAi() {
  return (
    <section className="hl-section hl-section-tight hl-wrap">
      <div className="hl-head">
        <h2 className="hl-h2">Bring the AI you trust.</h2>
        <p className="hl-lead">Pick one for each job. Swap any time.</p>
      </div>
      <div className="hl-ai">
        <div className="hl-ai-card hl-glass">
          <div className="hl-ai-art" style={{ background: "linear-gradient(135deg, rgba(62,99,245,.14), rgba(139,92,246,.12))" }}>
            <svg width="92" height="70" viewBox="0 0 96 72" fill="none" stroke="#3e63f5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="14" y="6" width="68" height="46" rx="7" />
              <path d="M4 60h88" strokeWidth="5" />
              <path d="m36 24 8 6-8 6M50 37h10" stroke="#8b5cf6" />
            </svg>
          </div>
          <h3 className="hl-h3">On your computer</h3>
          <p>Sees only the folders you choose.</p>
        </div>
        <div className="hl-ai-card hl-glass">
          <div className="hl-ai-art" style={{ background: "linear-gradient(135deg, rgba(34,197,94,.14), rgba(62,99,245,.12))" }}>
            <svg width="78" height="78" viewBox="0 0 80 80" fill="none" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
              <path d="M40 6 12 18v20c0 17 12 29 28 34 16-5 28-17 28-34V18Z" stroke="#8b5cf6" />
              <path d="m28 40 8 8 16-16" stroke="#22c55e" strokeWidth="4" />
            </svg>
          </div>
          <h3 className="hl-h3">In a private vault</h3>
          <p>Always on. You can check what runs inside.</p>
        </div>
        <div className="hl-ai-card hl-glass">
          <div className="hl-ai-art" style={{ background: "linear-gradient(135deg, rgba(236,72,153,.14), rgba(245,158,11,.12))" }}>
            <svg width="96" height="64" viewBox="0 0 96 64" fill="none" strokeWidth="3" aria-hidden="true">
              <rect x="6" y="18" width="34" height="28" rx="9" stroke="#3e63f5" />
              <rect x="56" y="18" width="34" height="28" rx="9" stroke="#ec4899" />
              <path d="M40 32h16" stroke="#8b5cf6" strokeDasharray="3 4" />
              <circle cx="23" cy="32" r="5" fill="#3e63f5" stroke="none" />
              <circle cx="73" cy="32" r="5" fill="#ec4899" stroke="none" />
            </svg>
          </div>
          <h3 className="hl-h3">The one you already use</h3>
          <p>For one job, kept out of the rest.</p>
        </div>
      </div>
    </section>
  );
}

const APPS = ["chat", "calendar", "docs", "sheets", "crm", "issues", "sign", "pass", "updates", "standup", "vote", "design"];

function Apps() {
  return (
    <section id="apps" className="hl-section hl-section-tight hl-wrap">
      <div className="hl-head">
        <h2 className="hl-h2">Works with your team’s apps.</h2>
        <p className="hl-lead">Private apps, built on Calimero.</p>
      </div>
      <div className="hl-apps hl-glass">
        {APPS.map((app) => (
          <div key={app} className="hl-app-tile">
            <Icon app={app} />
            {appLook(app).name}
          </div>
        ))}
      </div>
    </section>
  );
}

function Questions() {
  return (
    <section className="hl-section hl-section-tight hl-wrap">
      <div className="hl-head">
        <h2 className="hl-h2">Quick answers.</h2>
      </div>
      <div className="hl-faq">
        <details className="hl-glass">
          <summary>Do I need to be technical?</summary>
          <p>
            No. Install the{" "}
            <a href={DOWNLOAD} target="_blank" rel="noreferrer">
              Calimero desktop app
            </a>
            , open Hyperfeed and create your feed. The demo needs nothing at all.
          </p>
        </details>
        <details className="hl-glass">
          <summary>Can an assistant do something I didn’t want?</summary>
          <p>Only what your rules allow. Money, signing, new contacts and deleting always ask you, and anything can be undone.</p>
        </details>
        <details className="hl-glass">
          <summary>Where is my data?</summary>
          <p>On your own Calimero node, synced only between your devices. There is no Hyperfeed server holding it.</p>
        </details>
      </div>
    </section>
  );
}

function Closing({ connect }: { connect: () => void }) {
  return (
    <section id="start" className="hl-section hl-section-tight hl-wrap">
      <div className="hl-closing hl-glass">
        <BrandMark size={64} />
        <h2 className="hl-h2">
          Let the assistants work. <span className="hl-grad">You decide.</span>
        </h2>
        <div className="hl-ctas">
          <button type="button" className="hl-btn hl-btn-primary" onClick={connect}>
            Open your feed
          </button>
          <Link className="hl-btn hl-btn-ghost" to="/demo">
            Try the demo
          </Link>
        </div>
      </div>
    </section>
  );
}
