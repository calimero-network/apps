import { MotionConfig, motion, useScroll, useTransform, type Variants } from "framer-motion";
import { useRef, type ReactNode } from "react";
import * as I from "./components/Icons";

const GITHUB = "https://github.com/calimero-network/mero-ar";
const media = (file: string) => `/media/${file}`;

const rise: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 90, damping: 18 } },
};

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09 } },
};

/** `?still` renders every section in place with no motion (screenshots, print). */
const STILL = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("still");

function Reveal({ children, className, onLoad }: { children: ReactNode; className?: string; onLoad?: boolean }) {
  if (STILL) {
    return (
      <motion.div className={className} variants={stagger} initial={false} animate="show">
        {children}
      </motion.div>
    );
  }
  return (
    <motion.div
      className={className}
      variants={stagger}
      initial="hidden"
      {...(onLoad ? { animate: "show" } : { whileInView: "show", viewport: { once: true, margin: "-80px" } })}
    >
      {children}
    </motion.div>
  );
}

function Item({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={rise}>
      {children}
    </motion.div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion={STILL ? "always" : "user"}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Backdrop />
      <Nav />
      <main id="main">
        <Hero />
        <Film />
        <HowItWorks />
        <Features />
        <RoomIn3D />
        <Clips />
        <Honest />
        <Faq />
        <Final />
      </main>
      <Footer />
    </MotionConfig>
  );
}

function Backdrop() {
  const { scrollYProgress } = useScroll();
  const y1 = useTransform(scrollYProgress, [0, 1], ["0%", "40%"]);
  const y2 = useTransform(scrollYProgress, [0, 1], ["0%", "-30%"]);
  return (
    <div className="backdrop" aria-hidden>
      <motion.div className="orb violet" style={{ y: y1 }} />
      <motion.div className="orb cyan" style={{ y: y2 }} />
      <div className="grid-floor" />
    </div>
  );
}

function Nav() {
  return (
    <header className="nav container">
      <div className="nav-inner glass">
        <a className="brand" href="#top" aria-label="Mero AR home">
          <img src="/favicon.svg" alt="" />
          Mero AR
        </a>
        <nav className="nav-links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#room">Your room</a>
          <a href="#see-it">See it</a>
          <a href="#honest">Limits</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="btn small" href={GITHUB}>
          <I.GitHub />
          GitHub
        </a>
      </div>
    </header>
  );
}

function Hero() {
  const stage = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "end start"] });
  const tilt = useTransform(scrollYProgress, [0, 0.5, 1], [10, 0, -8]);
  return (
    <section className="hero container" id="top">
      <div className="hero-grid">
        <Reveal className="hero-copy" onLoad>
          <Item>
            <span className="eyebrow">
              <I.Cube width={16} height={16} /> Collaborative AR on Calimero
            </span>
          </Item>
          <Item>
            <h1>
              Build in your room. <span className="gradient-text">Together.</span>
            </h1>
          </Item>
          <Item>
            <p className="lede">
              Scan a room, drop 3D objects into it and shape it with the people you invite. Every change syncs peer to
              peer between their own nodes, with no central server holding your space.
            </p>
          </Item>
          <Item className="cta-row">
            <a className="btn primary" href="#film">
              <I.Play /> Watch the film
            </a>
            <a className="btn" href={GITHUB}>
              <I.GitHub /> View the code
            </a>
          </Item>
          <Item className="hero-meta">
            <span>
              <I.Nodes width={16} height={16} /> Peer to peer
            </span>
            <span>
              <I.Scan width={16} height={16} /> ARKit room scans
            </span>
            <span>
              <I.Shield width={16} height={16} /> Open source
            </span>
          </Item>
        </Reveal>

        <div className="phone-stage" ref={stage}>
          <motion.div
            className="phone"
            style={{ rotateY: tilt, transformPerspective: 1200 }}
            initial={STILL ? false : { opacity: 0, scale: 0.92, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 70, damping: 16, delay: 0.2 }}
          >
            <video
              src={media("clip-room.mp4")}
              poster={media("clip-room.jpg")}
              autoPlay
              muted
              loop
              playsInline
              aria-label="Screen recording: building a shared room in Mero AR"
            />
          </motion.div>
          <FloatChip style={{ top: "14%", left: "-2%" }} delay={0.7}>
            <span className="dot" /> Maya placed a sphere
          </FloatChip>
          <FloatChip style={{ top: "48%", right: "-4%" }} delay={1}>
            <I.Lock width={16} height={16} /> Locked by Leo
          </FloatChip>
          <FloatChip style={{ bottom: "12%", left: "4%" }} delay={1.3}>
            <I.Note width={16} height={16} /> "Sofa goes here"
          </FloatChip>
        </div>
      </div>
    </section>
  );
}

function FloatChip({
  children,
  style,
  delay,
}: {
  children: ReactNode;
  style: React.CSSProperties;
  delay: number;
}) {
  return (
    <motion.div
      className="float-chip glass"
      style={style}
      initial={STILL ? false : { opacity: 0, y: 12 }}
      animate={STILL ? { opacity: 1 } : { opacity: 1, y: [0, -8, 0] }}
      transition={{
        opacity: { delay, duration: 0.5 },
        y: { delay, duration: 5, repeat: Infinity, ease: "easeInOut" },
      }}
      aria-hidden
    >
      {children}
    </motion.div>
  );
}

function Film() {
  return (
    <section className="container" id="film" aria-labelledby="film-title">
      <Reveal>
        <Item className="section-head">
          <span className="eyebrow">The film</span>
          <h2 id="film-title">Fifty seconds of Mero AR.</h2>
        </Item>
        <Item>
          <div className="film glass">
            <video
              src={media("promo.mp4")}
              poster={media("promo-poster.jpg")}
              controls
              preload="metadata"
              playsInline
              aria-label="Mero AR promotional film"
            />
          </div>
          <p className="illustration-note">
            The app scenes are real recordings from the iOS Simulator against a local node. The shots of a phone in a
            room are motion graphics, illustrating what live AR looks like on an ARKit device.
          </p>
        </Item>
      </Reveal>
    </section>
  );
}

const steps = [
  {
    icon: <I.Scan />,
    title: "Scan the room",
    body: "Your iPhone maps the room with ARKit. Share the scan and it's stored in the room as a blob, so the next device lines up in the same space.",
  },
  {
    icon: <I.Nodes />,
    title: "Each device, its own node",
    body: "Every person's device talks to their own Calimero node: one they run, or one hosted for their account in Calimero Cloud.",
  },
  {
    icon: <I.Layers />,
    title: "One scene, as a CRDT",
    body: "Objects, locks, notes and roles live in the room's contract state, a CRDT that merges edits from everyone without a central server.",
  },
  {
    icon: <I.Users />,
    title: "Peer-to-peer sync",
    body: "Nodes exchange changes directly. When Maya moves a chair, Leo's node applies it and his phone updates live.",
  },
];

function HowItWorks() {
  return (
    <section className="container" id="how" aria-labelledby="how-title">
      <Reveal>
        <Item className="section-head">
          <span className="eyebrow">How it works</span>
          <h2 id="how-title">A room is a shared context, not a server.</h2>
          <p className="lede">
            Mero AR is built on Calimero. A room is a context: a small application state that only its members hold and
            replicate between their nodes.
          </p>
        </Item>
        <div className="steps">
          {steps.map((s, i) => (
            <Item className="step glass" key={s.title}>
              <div className="icon-tile">{s.icon}</div>
              <span className="step-num">0{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </Item>
          ))}
        </div>
        <Item className="diagram glass">
          <SyncDiagram />
        </Item>
      </Reveal>
    </section>
  );
}

function SyncDiagram() {
  const nodes = [
    { x: 140, label: "Maya's phone", sub: "her node" },
    { x: 500, label: "Leo's iPad", sub: "his node" },
    { x: 860, label: "Sam's phone", sub: "Calimero Cloud node" },
  ];
  return (
    <svg viewBox="0 0 1000 300" role="img" aria-label="Three devices, each with its own node, exchanging scene changes peer to peer around one shared room state">
      <defs>
        <linearGradient id="aur" x1="0" x2="1">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <motion.rect
        x="380"
        y="196"
        width="240"
        height="74"
        rx="20"
        fill="rgba(139,92,246,0.14)"
        stroke="url(#aur)"
        strokeWidth="2"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.6 }}
      />
      <text x="500" y="228" textAnchor="middle" fontSize="18" fontWeight="700">
        Room state (CRDT)
      </text>
      <text x="500" y="252" textAnchor="middle" fontSize="14" className="sub">
        objects · locks · notes · roles · scan
      </text>
      {nodes.map((n, i) => (
        <g key={n.label}>
          <motion.path
            d={`M ${n.x} 120 Q ${(n.x + 500) / 2} 170 500 196`}
            fill="none"
            stroke="url(#aur)"
            strokeWidth="2"
            strokeDasharray="6 8"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.1, delay: 0.3 + i * 0.15 }}
          />
          <motion.circle
            r="6"
            fill="#22d3ee"
            animate={{ cx: [n.x, 500], cy: [120, 196] }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeInOut" }}
          />
          <rect x={n.x - 100} y="40" width="200" height="80" rx="22" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.16)" />
          <text x={n.x} y="76" textAnchor="middle" fontSize="17" fontWeight="700">
            {n.label}
          </text>
          <text x={n.x} y="100" textAnchor="middle" fontSize="14" className="sub">
            {n.sub}
          </text>
        </g>
      ))}
      <path d="M 240 80 L 400 80 M 600 80 L 760 80" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" strokeDasharray="3 6" />
      <text x="320" y="70" textAnchor="middle" fontSize="12" className="sub">
        peer to peer
      </text>
      <text x="680" y="70" textAnchor="middle" fontSize="12" className="sub">
        peer to peer
      </text>
    </svg>
  );
}

const features = [
  { icon: <I.Cube />, title: "Place and edit together", body: "Cubes, spheres, arrows, markers and 3D labels. Move, turn, resize and paint them; everyone sees it at once." },
  { icon: <I.Lock />, title: "Locks", body: "Lock an object while you work on it. Nobody else can move it until you let go." },
  { icon: <I.Note />, title: "Notes in space", body: "Pin a note next to an object, like \"sofa goes here\", for whoever walks the room next." },
  { icon: <I.Users />, title: "Roles", body: "The room's creator is its admin. Invite people as viewers and promote them to editors when they should build." },
  { icon: <I.Link />, title: "Invite by link", body: "An invite is a signed link. Share it from the system share sheet, or copy it into any chat." },
  { icon: <I.Eye />, title: "3D preview anywhere", body: "No ARKit device at hand? The same shared room opens as an orbitable 3D preview, tools included." },
];

function Features() {
  return (
    <section className="container" id="features" aria-labelledby="features-title">
      <Reveal>
        <Item className="section-head">
          <span className="eyebrow">Features</span>
          <h2 id="features-title">Everything a room needs, nothing it doesn't.</h2>
        </Item>
        <div className="features">
          {features.map((f) => (
            <Item className="feature glass" key={f.title}>
              <div className="icon-tile">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </Item>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

const roomSteps = [
  {
    icon: <I.Scan />,
    title: "Scan it",
    body: "Walk the room with a LiDAR iPhone or iPad. Apple's RoomPlan finds the walls, doors, windows and furniture.",
  },
  {
    icon: <I.Layers />,
    title: "Share it",
    body: "The room travels as a small model plus a full USDZ, stored as blobs inside your Mero AR room, so only its members get it.",
  },
  {
    icon: <I.Users />,
    title: "Decorate it together",
    body: "Everyone opens the same 3D room on any device, adds and drags items across the floor plan, and sees each other's changes live.",
  },
];

function RoomIn3D() {
  return (
    <section className="container" id="room" aria-labelledby="room-title">
      <div className="room-grid">
        <Reveal>
          <Item className="section-head">
            <span className="eyebrow">New · Your room, in 3D</span>
            <h2 id="room-title">Scan your room. Redecorate it together.</h2>
            <p className="lede">
              Turn your real room into a 3D model, share it with the people in your Mero AR room, and plan it together: move
              the sofa, try a shelf by the window, leave a note by the door. Every edit syncs peer to peer.
            </p>
          </Item>
          <div className="room-steps">
            {roomSteps.map((st) => (
              <Item className="room-step glass" key={st.title}>
                <div className="icon-tile">{st.icon}</div>
                <div>
                  <h3>{st.title}</h3>
                  <p>{st.body}</p>
                </div>
              </Item>
            ))}
          </div>
          <Item>
            <p className="illustration-note">
              The recording uses Mero AR's built-in sample room in the iOS Simulator, labelled as a sample in the app.
              Scanning needs a LiDAR device; anyone can view and edit a shared room on any iPhone or iPad.
            </p>
          </Item>
        </Reveal>
        <Reveal className="room-phone">
          <Item>
            <div className="phone">
              <video
                src={media("clip-scan.mp4")}
                poster={media("clip-scan.jpg")}
                autoPlay
                muted
                loop
                playsInline
                aria-label="Screen recording: the sample living room shared in 3D, items added and moved on the floor plan"
              />
            </div>
          </Item>
        </Reveal>
      </div>
    </section>
  );
}

const clips = [
  { file: "clip-signin", title: "Sign in", body: "Calimero Cloud with a passkey, or your own node's URL." },
  { file: "clip-room", title: "Build a room", body: "Create a room, add objects, pin a note." },
  { file: "clip-invite", title: "Invite people", body: "Mint a signed invite link, then share or copy it." },
];

function Clips() {
  return (
    <section className="container" id="see-it" aria-labelledby="clips-title">
      <Reveal>
        <Item className="section-head">
          <span className="eyebrow">See it</span>
          <h2 id="clips-title">Real recordings from the app.</h2>
          <p className="lede">
            Captured in the iOS Simulator against a local Calimero node, so the room shows as its 3D preview. On an
            ARKit iPhone the same tools sit over the camera.
          </p>
        </Item>
        <div className="clips">
          {clips.map((c) => (
            <Item key={c.file}>
              <figure className="clip glass" style={{ margin: 0 }}>
                <video
                  src={media(`${c.file}.mp4`)}
                  poster={media(`${c.file}.jpg`)}
                  muted
                  loop
                  playsInline
                  autoPlay
                  preload="metadata"
                  aria-label={`Screen recording: ${c.title}`}
                />
                <figcaption>
                  <h3>{c.title}</h3>
                  <span>{c.body}</span>
                </figcaption>
              </figure>
            </Item>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function Honest() {
  return (
    <section className="container" id="honest" aria-labelledby="honest-title">
      <Reveal>
        <Item className="section-head">
          <span className="eyebrow">Privacy and limits</span>
          <h2 id="honest-title">What it does, and what it doesn't.</h2>
        </Item>
        <div className="honest">
          <Item className="glass">
            <h3>What holds</h3>
            <ul>
              <li>
                <I.Check style={{ color: "var(--success)" }} />
                No central Mero AR server. The room's state lives on the nodes of its members and syncs between them.
              </li>
              <li>
                <I.Check style={{ color: "var(--success)" }} />
                Only members hold the room. Joining takes a signed invitation, and roles are enforced by the room's
                contract on every node.
              </li>
              <li>
                <I.Check style={{ color: "var(--success)" }} />
                The room scan is shared as a blob inside the room, reachable only through it.
              </li>
              <li>
                <I.Check style={{ color: "var(--success)" }} />
                The app and its contract are open source.
              </li>
            </ul>
          </Item>
          <Item className="glass">
            <h3>Good to know</h3>
            <ul>
              <li>
                <I.Alert style={{ color: "var(--warning)" }} />
                Live AR needs an ARKit iPhone or iPad. Scene reconstruction is better with LiDAR. Elsewhere you get the 3D
                preview.
              </li>
              <li>
                <I.Alert style={{ color: "var(--warning)" }} />
                Whoever runs a member's node can read that member's copy of the room. With Calimero Cloud, that's a hosted
                node; run your own if that matters.
              </li>
              <li>
                <I.Alert style={{ color: "var(--warning)" }} />
                A room scan is a map of your space. Share it only with people you'd show the room to.
              </li>
              <li>
                <I.Alert style={{ color: "var(--warning)" }} />
                Lining up two devices relies on ARKit relocalization, which needs a similar view of the room and decent
                light.
              </li>
            </ul>
          </Item>
        </div>
      </Reveal>
    </section>
  );
}

const faqs = [
  {
    q: "Do I need to run a node?",
    a: "No. Sign in with Calimero Cloud and a node is hosted for your account. If you'd rather run your own, enter its URL on the sign-in screen.",
  },
  {
    q: "How do two phones end up in the same space?",
    a: "One person scans the room and shares the scan. It's stored in the room as an ARWorldMap blob, and other devices relocalize into it, so objects appear in the same physical spots.",
  },
  {
    q: "What happens when two people move the same object?",
    a: "Edits merge as CRDT operations, and the latest move wins. To avoid that, lock an object while you work on it.",
  },
  {
    q: "Can I scan my room without LiDAR?",
    a: "No. Scanning uses Apple's RoomPlan, which needs a LiDAR iPhone (12 Pro and later Pro models) or iPad. Once someone has scanned a room, everyone can open and edit it on any device, and there's a clearly labelled sample room to try it out.",
  },
  {
    q: "Can someone without the app see the room?",
    a: "Only members can open a room. Viewers can look around; editors and admins can place, move and annotate.",
  },
  {
    q: "Which devices does it run on?",
    a: "iPhone and iPad with ARKit for live AR, and the 3D preview on any device or the Simulator.",
  },
];

function Faq() {
  return (
    <section className="container" id="faq" aria-labelledby="faq-title">
      <Reveal>
        <Item className="section-head">
          <span className="eyebrow">FAQ</span>
          <h2 id="faq-title">Questions, answered.</h2>
        </Item>
        <div className="faq">
          {faqs.map((f) => (
            <Item key={f.q}>
              <details className="glass">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            </Item>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function Final() {
  return (
    <section className="container">
      <Reveal>
        <Item className="final glass">
          <img src="/favicon.svg" alt="" width={64} height={64} />
          <h2>Make a room worth sharing.</h2>
          <p className="lede">Mero AR is open source and built on Calimero. Clone it, run it on your node, and invite someone.</p>
          <div className="cta-row" style={{ justifyContent: "center" }}>
            <a className="btn primary" href={GITHUB}>
              <I.GitHub /> Get the code
            </a>
            <a className="btn" href="https://calimero.network">
              About Calimero
            </a>
          </div>
        </Item>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="container">
      <div className="footer-inner">
        <span>Mero AR · built on Calimero · MIT licensed</span>
        <nav aria-label="Footer">
          <a href={GITHUB}>GitHub</a>
          <a href="https://calimero.network">Calimero</a>
          <a href="#faq">FAQ</a>
        </nav>
      </div>
    </footer>
  );
}
