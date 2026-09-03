/**
 * The explainer this app never had.
 *
 * Before it, `/` was the feed: an unauthenticated visitor got an empty list, a
 * composer that could only throw, and no statement of what the app is or what
 * it needs. Structure follows the fleet's landing pages (mero-pixart,
 * mero-stream, mero-design) so the apps read as one family — hero, a preview of
 * the real thing, features, how it works, FAQ, footer.
 *
 * The preview is a static mock-up of this app's own feed, deliberately: it is
 * the one thing a visitor cannot see before connecting a node.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import styles from "./LandingPage.module.css";

const PREVIEW_POSTS = [
  {
    score: 42,
    title: "Namespace invitations now carry admitters",
    author: "ana",
    age: "3h",
    comments: 12,
    voted: true,
  },
  {
    score: 18,
    title: "Anyone else running two nodes on one host?",
    author: "bruno",
    age: "7h",
    comments: 5,
  },
  {
    score: 9,
    title: "Weekly: what did you ship?",
    author: "chen",
    age: "1d",
    comments: 23,
  },
];

function FeedPreview() {
  return (
    <div className={styles.preview}>
      <div className={styles.previewTop}>
        <span className={styles.previewBrand}>
          mero<span>forum</span>
        </span>
        <div className={styles.previewTabs}>
          <span className={styles.previewTabActive}>New</span>
          <span className={styles.previewTab}>Top</span>
        </div>
        <span className={styles.previewConnected}>● node connected</span>
      </div>
      {PREVIEW_POSTS.map((p) => (
        <div key={p.title} className={styles.previewPost}>
          <div className={styles.previewVote}>
            <span className={p.voted ? styles.previewArrowOn : styles.previewArrow}>▲</span>
            <span className={styles.previewScore}>{p.score}</span>
            <span className={styles.previewArrow}>▼</span>
          </div>
          <div className={styles.previewBody}>
            <div className={styles.previewTitle}>{p.title}</div>
            <div className={styles.previewMeta}>
              {p.author} · {p.age} · {p.comments} comments
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const FEATURES: [string, string, string][] = [
  ["◈", "Threaded discussion", "Posts and nested comments, stored in a Calimero context on your own node."],
  ["▲", "Voting that converges", "Each vote is one CRDT entry keyed by account, so a score settles the same way on every peer."],
  ["⇄", "P2P sync", "New posts reach members over gossip. No relay, no server holding the thread."],
  ["⚿", "Members you invited", "A forum is a namespace. Only the people you send an invitation to can read or post."],
  ["↕", "New and Top", "Sort by recency or by score. Both are contract views, paged as you scroll."],
  ["⌂", "Self-hosted", "Your node, your keys, your discussion. Nothing is stored anywhere else."],
];

const STEPS: [string, string, string][] = [
  ["01", "Run your node", "Start a Calimero node locally. It holds the forum and its history."],
  ["02", "Connect", "Click Connect a node and pick it from the list. No account, no email."],
  ["03", "Create a forum", "Name it. That makes a namespace and one context inside it."],
  ["04", "Invite people", "Send them an invitation. They join from their own node and posts sync P2P."],
];

const FAQ: [string, string][] = [
  ["Do I need an account?", "No. You connect the node you run; the node's identity is your identity."],
  ["Where do posts live?", "In a Calimero context on the nodes of the members. There is no central copy."],
  ["What is a forum, technically?", "A namespace with one context inside it. The namespace is who can read; the context is the discussion."],
  ["Can I run more than one?", "Yes. Each forum is its own context, and the switcher lists every one this node belongs to."],
  ["Why can't I post before connecting?", "The posts are a contract call. Without a node there is nothing to call, which is why the app now asks you to connect first instead of failing on submit."],
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useMero();
  const [menuOpen, setMenuOpen] = useState(false);

  const enter = () => navigate(isAuthenticated ? "/f" : "/login");
  const REPO = "https://github.com/calimero-network/apps/tree/main/apps/mero-forum";

  return (
    <div className={styles.root}>
      <section className={styles.heroSection}>
        <header className={styles.header}>
          <span className={styles.logo}>
            mero<span>forum</span>
          </span>
          <nav className={styles.nav}>
            <a href="#features" className={styles.navLink}>Features</a>
            <a href="#how" className={styles.navLink}>How it works</a>
            <a href="#faq" className={styles.navLink}>FAQ</a>
            <a href={REPO} target="_blank" rel="noopener noreferrer" className={styles.navLink}>GitHub</a>
          </nav>
          <button className={styles.headerCta} onClick={enter}>
            {isAuthenticated ? "Open forum" : "Connect a node"}
          </button>
          <button
            className={styles.hamburger}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
          {menuOpen && (
            <div className={styles.mobileMenu}>
              <a href="#features" className={styles.mobileItem} onClick={() => setMenuOpen(false)}>Features</a>
              <a href="#how" className={styles.mobileItem} onClick={() => setMenuOpen(false)}>How it works</a>
              <a href="#faq" className={styles.mobileItem} onClick={() => setMenuOpen(false)}>FAQ</a>
              <a href={REPO} target="_blank" rel="noopener noreferrer" className={styles.mobileItem}>GitHub</a>
              <button className={styles.mobileCta} onClick={() => { setMenuOpen(false); enter(); }}>
                {isAuthenticated ? "Open forum" : "Connect a node"}
              </button>
            </div>
          )}
        </header>

        <div className={styles.glow1} aria-hidden="true" />
        <div className={styles.glow2} aria-hidden="true" />

        <main className={styles.hero}>
          <div className={styles.badge}>Open source · P2P · Self-hosted</div>
          <h1 className={styles.headline}>
            A forum that lives on your nodes.
            <br />
            <span className={styles.headlineAccent}>Not on someone's server.</span>
          </h1>
          <p className={styles.sub}>
            Mero Forum is threaded discussion inside a Calimero context. Posts,
            comments and votes replicate peer to peer between the members you
            invited — and nowhere else.
          </p>
          <div className={styles.heroActions}>
            <button className={styles.ctaPrimary} onClick={enter}>
              {isAuthenticated ? "Open forum →" : "Get started →"}
            </button>
            <a className={styles.ctaSecondary} href={REPO} target="_blank" rel="noopener noreferrer">
              View on GitHub →
            </a>
          </div>
        </main>
      </section>

      <section className={styles.previewSection}>
        <div className={styles.eyebrow}>What you get once a node is connected</div>
        <div className={styles.previewWrap}>
          <FeedPreview />
        </div>
      </section>

      <section id="features" className={styles.section}>
        <div className={styles.inner}>
          <h2 className={styles.sectionTitle}>What it does</h2>
          <p className={styles.sectionSub}>Discussion, with the hosting removed.</p>
          <div className={styles.grid}>
            {FEATURES.map(([icon, title, body]) => (
              <div key={title} className={styles.card}>
                <div className={styles.cardIcon} aria-hidden="true">{icon}</div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className={styles.sectionAlt}>
        <div className={styles.inner}>
          <h2 className={styles.sectionTitle}>How it works</h2>
          <ol className={styles.steps}>
            {STEPS.map(([n, title, body]) => (
              <li key={n} className={styles.step}>
                <span className={styles.stepNum}>{n}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="faq" className={styles.section}>
        <div className={styles.inner}>
          <h2 className={styles.sectionTitle}>FAQ</h2>
          <div className={styles.faq}>
            {FAQ.map(([q, a]) => (
              <div key={q} className={styles.faqItem}>
                <strong>{q}</strong>
                <p>{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <div>
            <span className={styles.logo}>
              mero<span>forum</span>
            </span>
            <p className={styles.footerTagline}>
              Threaded discussion on the Calimero p2p network.
            </p>
          </div>
          <div className={styles.footerCols}>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Product</div>
              <a href="#features" className={styles.footerLink}>Features</a>
              <a href="#how" className={styles.footerLink}>How it works</a>
              <a href="#faq" className={styles.footerLink}>FAQ</a>
            </div>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Calimero</div>
              <a href="https://calimero.network" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Website</a>
              <a href="https://docs.calimero.network" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Docs</a>
              <a href="https://github.com/calimero-network/core" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Core node</a>
              <a href={REPO} target="_blank" rel="noopener noreferrer" className={styles.footerLink}>This app</a>
            </div>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span>© 2026 Calimero Network</span>
          <span>MIT License</span>
        </div>
      </footer>
    </div>
  );
}
