import { motion } from "framer-motion";
import { Icon } from "../components/Icon";
import { Reveal } from "../components/Reveal";

const features = [
  { icon: "map" as const, title: "Live, not polled", body: "Updates arrive as events from the space, so the map moves when people do." },
  { icon: "hand" as const, title: "Stop any time", body: "Sharing is per tracker. Stop it and this phone stops sending its position." },
  { icon: "battery" as const, title: "Battery at a glance", body: "Each tracker reports its battery, so you know why someone went quiet." },
  { icon: "link" as const, title: "Invite links", body: "Signed invitations, valid for a day, that work as a link or a pasted code." },
  { icon: "pulse" as const, title: "Who's online", body: "Presence shows who's around right now and when others were last seen." },
  { icon: "shield" as const, title: "Open source", body: "The app and its contract are public. Read exactly what's stored, and where." },
];

export function Features() {
  return (
    <section className="section">
      <Reveal>
        <p className="eyebrow center">Features</p>
        <h2 className="center">Everything a family map needs. Nothing it doesn't.</h2>
      </Reveal>
      <div className="grid">
        {features.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 0.08}>
            <motion.article className="feature" whileHover={{ y: -6 }} transition={{ type: "spring", stiffness: 300, damping: 22 }}>
              <div className="feature-icon">
                <Icon name={f.icon} />
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </motion.article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
