import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "./landing.css";
import { DOWNLOAD, LandingShell, useConnect } from "./chrome";
import { Badge, LiveFeed } from "./LiveFeed";

/**
 * Hyperfeed's front door for signed-out visitors.
 *
 * Hand-owned, like mero-pass's: Hyperfeed left the shared landing template
 * (scripts/landing) for a page in the app's own look. Every claim on it is
 * something the app does today; tests/marketing-landing.spec.ts holds it to
 * that shape.
 */
export default function LandingPage() {
  const { connect, dialog } = useConnect();
  return (
    <LandingShell page="home" connect={connect}>
      <Hero connect={connect} />
      <AppsStrip />
      <Lanes />
      <AnswerInPlace />
      <Rules />
      <Trust />
      <Keys />
      <Start />
      <Closing connect={connect} />
      {dialog}
    </LandingShell>
  );
}

function Hero({ connect }: { connect: () => void }) {
  return (
    <section className="hl-hero hl-grid-bg" aria-labelledby="hl-title">
      <div className="hl-wrap hl-split hl-hero-inner">
        <div className="hl-stack">
          <span className="hl-pill hl-pill-busy hl-kicker">
            <span className="hl-pulse" />
            Your agent, accountable
          </span>
          <h1 id="hl-title" className="hl-h1">
            Everything your agent does. One feed.
          </h1>
          <p className="hl-lead hl-lead-lg">
            Hyperfeed puts your agent's work, its questions and your apps' notifications into three lanes: to do, in
            progress and done. Approve, answer or undo in place, then move on. It all lives on your own node.
          </p>
          <div className="hl-ctas">
            <button type="button" className="hl-btn hl-btn-primary" onClick={connect}>
              Open your feed
            </button>
            <Link className="hl-btn hl-btn-ghost" to="/demo">
              Try the demo, no node needed
            </Link>
          </div>
          <ul className="hl-trust">
            <li>Only you write to your feed</li>
            <li>Every action has provenance</li>
            <li>Open source</li>
          </ul>
        </div>
        <LiveFeed />
      </div>
    </section>
  );
}

const APPS = [
  { app: "chat", ab: "Ch", name: "Chat" },
  { app: "calendar", ab: "Ca", name: "Calendar" },
  { app: "design", ab: "De", name: "Design" },
  { app: "issues", ab: "Is", name: "Issues" },
  { app: "sheets", ab: "Sh", name: "Sheets" },
  { app: "bot", ab: "mb", name: "Your computer" },
];

function AppsStrip() {
  return (
    <section className="hl-strip" aria-label="Works with your apps">
      <div className="hl-wrap hl-strip-row">
        <span className="hl-muted">Reads what matters from the apps on your node</span>
        <ul className="hl-chips">
          {APPS.map((a) => (
            <li key={a.name} className="hl-chip">
              <Badge app={a.app} ab={a.ab} />
              {a.name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="hl-stack">
      <span className="hl-eyebrow">{eyebrow}</span>
      <h2 className="hl-h2">{title}</h2>
      {children}
    </div>
  );
}

function Lanes() {
  const lanes = [
    {
      tone: "wait",
      lane: "To do",
      title: "Needs you",
      body: "A permission your agent asked for, a message for you, a vote that opened. Answer it right in the row: approve, reply, pick an option.",
    },
    {
      tone: "busy",
      lane: "In progress",
      title: "Being carried out",
      body: "Your agent is thinking, an approved action is running, or your answer is on its way back to the app. You do not need to watch it.",
    },
    {
      tone: "good",
      lane: "Done",
      title: "Settled",
      body: "Archive it, or archive the whole lane in one click. Anything new in an archived chain brings it back by itself.",
    },
  ];
  return (
    <section id="lanes" className="hl-section">
      <div className="hl-wrap hl-stack-lg">
        <SectionHead eyebrow="Three lanes" title="Know what is yours, what is moving, and what is done.">
          <p className="hl-lead">
            Many sessions, many apps, one place to look. Every chain of work sits in exactly one lane, so nothing waits
            on you without you knowing.
          </p>
        </SectionHead>
        <div className="hl-cards">
          {lanes.map((l) => (
            <article key={l.lane} className="hl-card">
              <span className={`hl-pill hl-pill-${l.tone}`}>{l.lane}</span>
              <h3 className="hl-h3">{l.title}</h3>
              <p className="hl-muted hl-body">{l.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function AnswerInPlace() {
  return (
    <section className="hl-section hl-band">
      <div className="hl-wrap hl-split">
        <SectionHead eyebrow="Answer where it lands" title="Reply without opening another app.">
          <p className="hl-lead">
            A message in Chat, a poll in Vote, a document in Design: answer it from the feed and your answer goes back to
            the app. When you want the whole thread, open the app beside the feed, already signed in, at that exact
            channel or document.
          </p>
          <Link to="/demo" className="hl-more">
            See it in the demo →
          </Link>
        </SectionHead>
        <div className="hl-window" role="img" aria-label="A chat row opened in place, with a reply your agent drafted and an Open in Chat button">
          <div className="hl-row hl-row-head">
            <Badge app="chat" ab="Ch" />
            <div className="hl-row-text">
              <div className="hl-row-meta">Chat · #launch · Maya</div>
              <div className="hl-row-title">Can your agent pull the Q3 numbers?</div>
            </div>
            <span className="hl-pill hl-pill-wait">Needs you</span>
          </div>
          <div className="hl-reply">
            <div className="hl-muted hl-small">Your agent drafted a reply from the sheet</div>
            <div className="hl-draft">Q3 closed at the numbers in the Revenue tab, up on Q2. I've shared the sheet in #launch.</div>
            <div className="hl-ask-actions">
              <span className="hl-fake hl-fake-primary">Send to #launch</span>
              <span className="hl-fake">Open in Chat</span>
              <span className="hl-fake">Later</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const POLICIES = [
  { app: "chat", ab: "Ch", name: "Chat", on: "Act" },
  { app: "calendar", ab: "Ca", name: "Calendar", on: "Ask first" },
  { app: "design", ab: "De", name: "Design", on: "Act" },
  { app: "sheets", ab: "Sh", name: "Sheets", on: "Read only" },
  { app: "issues", ab: "Is", name: "Issues", on: "Off" },
];
const MODES = ["Act", "Ask first", "Read only", "Off"];

function Rules() {
  return (
    <section id="rules" className="hl-section">
      <div className="hl-wrap hl-split">
        <div className="hl-card hl-controls" role="img" aria-label="Controls: what your agent may do in each app, and the guards that always ask you">
          <div className="hl-controls-h">What your agent may do</div>
          {POLICIES.map((p) => (
            <div key={p.name} className="hl-policy">
              <Badge app={p.app} ab={p.ab} />
              <span className="hl-policy-name">{p.name}</span>
              <span className="hl-seg">
                {MODES.map((m) => (
                  <span key={m} className={m === p.on ? "on" : undefined}>
                    {m}
                  </span>
                ))}
              </span>
            </div>
          ))}
          <div className="hl-guards">
            <span className="hl-muted hl-small">Always ask me before</span>
            <span className="hl-pill hl-pill-wait">Signing</span>
            <span className="hl-pill hl-pill-wait">Money</span>
            <span className="hl-pill hl-pill-wait">New contacts</span>
          </div>
        </div>
        <SectionHead eyebrow="Your rules, checked first" title="Your agent acts where you let it, and asks everywhere else.">
          <p className="hl-lead">
            For each app, choose Act, Ask first, Read only or Off. Guards always ask, whatever an app allows. Every call
            your agent makes is checked against these rules before it runs, and one switch pauses it everywhere.
          </p>
          <p className="hl-lead">
            It covers your computer too. When mero-bot needs permission to run a command or write a file, the prompt
            lands in To do with the exact command.
          </p>
        </SectionHead>
      </div>
    </section>
  );
}

const TRUST = [
  {
    title: "Provenance on every row",
    body: "Which app, which method and why: each action carries its reason and the chain of events that led to it.",
    icon: <path d="M12 3 4 7v5c0 5 3.5 8 8 9 4.5-1 8-4 8-9V7Z" />,
  },
  {
    title: "On your node, written by you",
    body: "Your feed is a context only you write to, on your own Calimero node. No vendor database holds what your agent did.",
    icon: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
  },
  {
    title: "Lenses you approve",
    body: "Your agent learns what matters in each app and proposes a lens. Nothing from an app reaches your feed until you approve it.",
    icon: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      </>
    ),
  },
  {
    title: "You see when it is there",
    body: "Agent live, No agent connected, or Agent paused: the header always tells you whether anyone is working your feed.",
    icon: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  },
];

function Trust() {
  return (
    <section className="hl-section hl-band">
      <div className="hl-wrap hl-stack-lg">
        <SectionHead eyebrow="Built on trust you can check" title="Nothing happens off the record." />
        <div className="hl-cards hl-cards-4">
          {TRUST.map((t) => (
            <article key={t.title} className="hl-card">
              <svg className="hl-card-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {t.icon}
              </svg>
              <h3 className="hl-h3 hl-h3-sm">{t.title}</h3>
              <p className="hl-muted hl-body">{t.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const KEYS = [
  { caps: ["J", "K"], label: "Move between rows" },
  { caps: ["E"], label: "Archive" },
  { caps: ["S"], label: "Later: away for three hours" },
  { caps: ["O"], label: "Open in its app, beside the feed" },
  { caps: ["U"], label: "Undo" },
  { caps: ["Esc"], label: "Close the row" },
];

function Keys() {
  return (
    <section className="hl-section">
      <div className="hl-wrap hl-split">
        <SectionHead eyebrow="Made for hammering through" title="Your hands never leave the keyboard.">
          <p className="hl-lead">Act on a row and the next one opens. Clear a busy morning in minutes, with undo one key away.</p>
        </SectionHead>
        <dl className="hl-card hl-keys">
          {KEYS.map((k) => (
            <div key={k.label} className="hl-key">
              <dt>
                {k.caps.map((c) => (
                  <kbd key={c}>{c}</kbd>
                ))}
              </dt>
              <dd>{k.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Start() {
  return (
    <section id="start" className="hl-section hl-band">
      <div className="hl-wrap hl-stack-lg">
        <SectionHead eyebrow="Get started" title="Three steps to your feed." />
        <ol className="hl-cards hl-steps">
          <li className="hl-card">
            <span className="hl-step">1</span>
            <h3 className="hl-h3 hl-h3-sm">Connect your node</h3>
            <p className="hl-muted hl-body">
              Sign in to your Calimero node, or open Hyperfeed from the{" "}
              <a href={DOWNLOAD} target="_blank" rel="noreferrer">
                Calimero desktop app
              </a>
              .
            </p>
          </li>
          <li className="hl-card">
            <span className="hl-step">2</span>
            <h3 className="hl-h3 hl-h3-sm">Create your feed</h3>
            <p className="hl-muted hl-body">
              One click makes a feed only you write to. Make as many as you like and switch between them from the header.
            </p>
          </li>
          <li className="hl-card">
            <span className="hl-step">3</span>
            <h3 className="hl-h3 hl-h3-sm">Start your agent</h3>
            <p className="hl-muted hl-body">
              Run mero-bot on your machine. It finds your feed, reports in, and the header turns to Agent live.
            </p>
          </li>
        </ol>
      </div>
    </section>
  );
}

function Closing({ connect }: { connect: () => void }) {
  return (
    <section className="hl-closing hl-grid-bg">
      <div className="hl-wrap hl-closing-inner">
        <h2 className="hl-h2 hl-h2-xl">Let your agent work. Stay the one who decides.</h2>
        <p className="hl-lead">Open your feed on your node, or try every screen in the demo first.</p>
        <div className="hl-ctas hl-ctas-center">
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
