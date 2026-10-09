import { Link } from "react-router-dom";
import "./landing.css";
import { LandingShell, useConnect } from "./chrome";

/**
 * Hyperfeed's own documentation, at /docs.
 *
 * Every concept and storage claim here was read off the contract
 * (logic/src/lib.rs) and the app, not from memory: when a contract changes,
 * this page changes with it.
 */
type Section = {
  id: string;
  heading: string;
  paragraphs?: string[];
  terms?: { term: string; def: string }[];
  steps?: string[];
  bullets?: string[];
};

const SECTIONS: Section[] = [
  {
    id: "concepts",
    heading: "The words, and what they mean here",
    paragraphs: [
      "Your feed is one Calimero context. You create it, and only you write to it: your devices, and your agent, which writes as your node. Nothing in it is shared with anyone else.",
    ],
    terms: [
      { term: "Action", def: "Something your agent did, or wants to do: an app, a method, a title and its reason. A proposal waits for you; an outcome is reported after the fact." },
      { term: "Notification", def: "Something one of your apps said that concerns you, recorded through a lens you approved. Each carries a key, so two devices watching the same app record it once." },
      { term: "Chain", def: "The rows that happened because of one another: a mention, the agent’s proposal in answer to it, your decision, the outcome. The feed shows one row per chain." },
      { term: "Lane", def: "Where a chain sits: To do when anything in it needs you, In progress while your agent or the feed carries it, Done otherwise." },
      { term: "Ask", def: "How a row is answered in place: reply with text, choose one of a few options, or confirm with one button." },
      { term: "Policy", def: "What your agent may do in one app: act, ask first, read only, or off. An app you never set asks first." },
      { term: "Guard", def: "A kind of action that always needs you, whatever the app’s policy: signing, money, new contacts and deleting are on until you turn them off." },
      { term: "Lens", def: "What your feed reads from one app version: which events concern you and how they read. Your agent proposes one; nothing is recorded until you approve it in Controls." },
    ],
  },
  {
    id: "start",
    heading: "Getting started",
    paragraphs: ["To look around first, open the demo: the same screens against a feed kept in your browser, with a pretend agent. No node needed."],
    steps: [
      "Connect a node: press Open your feed and sign in on your node, or open Hyperfeed from the Calimero desktop app.",
      "Create your feed: one button makes the context. Notifications from your other apps start arriving while the app is open.",
      "Set your rules: on Controls, choose what your agent may do in each app, and which guards always ask you.",
      "Start your agent: run mero-bot against the same node. It finds your feed, reports in every half minute, and the header turns to Agent live.",
    ],
  },
  {
    id: "using",
    heading: "Working through your feed",
    bullets: [
      "Open a row to see its whole thread, its answer box and its actions. Act on it and the next row opens.",
      "J and K move between rows, E archives, S puts a row away for three hours, O opens it in its app, U undoes, Esc closes.",
      "Archive all done clears the Done lane. An archived chain comes back by itself when something new happens in it; Archived lists the rest.",
      "Open in its app shows the app beside the feed, signed in to your node, at the row’s channel or document. Only first-party apps are handed your session.",
      "The feed’s id beside the brand switches between your feeds without signing in again, and makes a new one.",
    ],
  },
  {
    id: "agent",
    heading: "Your agent",
    bullets: [
      "Every call your agent makes through your node is checked against your rules before it runs. Writes it may make run and are logged; guarded ones wait for you in To do; refused ones never run.",
      "When mero-bot needs permission for something on your computer, such as running a command or writing a file, the same prompt lands in To do with the exact command. Answer it there or at the terminal: the first answer wins.",
      "Your agent can never answer for you: approving, answering and changing your rules are refused to it.",
      "The header shows Agent live while an agent has reported in during the last 90 seconds, No agent connected otherwise, and Agent paused when you paused it.",
    ],
  },
  {
    id: "storage",
    heading: "What is stored, and where",
    bullets: [
      "Actions, notifications and your messages with your agent, each keeping its full history of steps, so every device shows the same flow in the same order.",
      "Your policy per app, your guards, the pause switch and the chains you archived, each where the latest decision wins.",
      "The lenses you approved, per app version, and when each agent last reported in.",
      "Nothing from your other apps but what their events said about you: a title, a sender, a short body.",
    ],
    paragraphs: [
      "Your node holds the whole feed, so it works offline and merges with your other devices when they meet again.",
    ],
  },
  {
    id: "trouble",
    heading: "When something looks wrong",
    terms: [
      { term: "No agent connected", def: "Nothing has reported in for 90 seconds. Start mero-bot against this node; if it stops with a 401, its sign-in expired: open the desktop app again or give it a username and password." },
      { term: "A notification never arrived", def: "Notifications are recorded while something watches: this app while it is open, or mero-bot while it runs. Check Controls too: an app with no approved lens records nothing." },
      { term: "You approved and nothing happened", def: "Your agent carries decisions out. Check the header says Agent live; mero-bot picks up approvals it missed when it starts." },
      { term: "Your agent asked when it could have acted", def: "A guard is on for that kind of action, the app is set to ask first, or the agent is paused. Controls shows all three." },
    ],
  },
];

export default function DocsPage() {
  const { connect, dialog } = useConnect();
  return (
    <LandingShell page="docs" connect={connect}>
      <div className="hl-wrap hl-docs">
        <nav className="hl-toc" aria-label="On this page">
          <span className="hl-toc-h">Docs</span>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.heading}
            </a>
          ))}
          <Link to="/demo">Try the demo →</Link>
        </nav>
        <article className="hl-doc">
          <div className="hl-stack">
            <span className="hl-eyebrow">Documentation</span>
            <h1 className="hl-h2">How Hyperfeed works</h1>
            <p className="hl-lead">
              One feed for your agent and your apps, on your own node. Here is what it holds, what your agent may do, and
              what to check when something looks wrong.
            </p>
          </div>
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
              <h2 id={`${s.id}-h`} className="hl-h3">
                {s.heading}
              </h2>
              {s.paragraphs?.map((p) => <p key={p}>{p}</p>)}
              {s.terms && (
                <dl className="hl-terms">
                  {s.terms.map((t) => (
                    <div key={t.term}>
                      <dt>{t.term}</dt>
                      <dd>{t.def}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {s.steps && (
                <ol className="hl-doc-steps">
                  {s.steps.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ol>
              )}
              {s.bullets && (
                <ul>
                  {s.bullets.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </article>
      </div>
      {dialog}
    </LandingShell>
  );
}
