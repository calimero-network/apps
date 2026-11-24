import { motion } from "framer-motion";
import { Icon } from "../components/Icon";
import { Reveal } from "../components/Reveal";

const steps = [
  {
    icon: "phone" as const,
    title: "Your phone",
    body: "Mero Tag reads your position while you're sharing, and writes it to your space — signed by this device.",
  },
  {
    icon: "node" as const,
    title: "Your account's node",
    body: "The space runs on a Calimero node: the relay that serves your account, or a node you run yourself. It keeps the space's state and hands updates to members.",
  },
  {
    icon: "people" as const,
    title: "Your people",
    body: "Everyone in the space sees the live map update within a second or two — over their own connection to the space.",
  },
];

export function HowItWorks() {
  return (
    <section className="section" id="how">
      <Reveal>
        <p className="eyebrow center">How it works</p>
        <h2 className="center">Three hops, and no one else's server.</h2>
      </Reveal>
      <div className="flow">
        {steps.map((step, i) => (
          <Reveal key={step.title} delay={i * 0.12} className="flow-step">
            <div className="flow-icon">
              <Icon name={step.icon} size={26} />
            </div>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </Reveal>
        ))}
        <svg className="flow-line" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden>
          <motion.path
            d="M80 20 C 300 -10, 400 50, 500 20 S 760 -10, 920 20"
            fill="none"
            stroke="url(#flowGrad)"
            strokeWidth="3"
            strokeDasharray="8 10"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.6, ease: "easeInOut" }}
          />
          <defs>
            <linearGradient id="flowGrad" x1="0" x2="1">
              <stop offset="0" stopColor="#5B4BFF" />
              <stop offset="1" stopColor="#14C99A" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <Reveal delay={0.2}>
        <p className="note center">
          Built on <a href="https://calimero.network">Calimero</a>: each space is a context — shared state that its
          members' nodes keep in sync. Sign in with Calimero Cloud and approve the phone with a passkey, or point the app
          at a node you run.
        </p>
      </Reveal>
    </section>
  );
}
