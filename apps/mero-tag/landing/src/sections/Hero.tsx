import { motion, useScroll, useTransform } from "framer-motion";
import { Icon } from "../components/Icon";
import { Phone } from "../components/Phone";
import { GITHUB } from "./Nav";

const ease = [0.22, 1, 0.36, 1] as const;

export function Hero() {
  const { scrollY } = useScroll();
  const phoneY = useTransform(scrollY, [0, 600], [0, -60]);
  const glowY = useTransform(scrollY, [0, 600], [0, 120]);

  return (
    <section className="hero" id="top">
      <motion.div className="hero-glow" style={{ y: glowY }} aria-hidden />
      <div className="radar" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{ animationDelay: `${i * 1.1}s` }} />
        ))}
      </div>
      <div className="hero-copy">
        <motion.p className="eyebrow" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
          Live location sharing · iOS
        </motion.p>
        <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.05, ease }}>
          Find your people.
          <br />
          <span className="gradient-text">Privately.</span>
        </motion.h1>
        <motion.p className="lede" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.15, ease }}>
          Mero Tag shows your friends and family on one live map. Positions travel through your own account's node to
          the people in your space — there's no tracking company in the middle collecting everyone's history.
        </motion.p>
        <motion.div className="cta" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.25, ease }}>
          <a className="btn btn-primary" href="#film">
            <Icon name="play" size={18} /> Watch the film
          </a>
          <a className="btn btn-ghost" href={GITHUB}>
            <Icon name="github" size={18} /> View the source
          </a>
        </motion.div>
      </div>
      <motion.div className="hero-phone" style={{ y: phoneY }}>
        <motion.div initial={{ opacity: 0, y: 60, rotate: -4 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: 1, delay: 0.2, ease }}>
        <Phone src="/media/live-map.mp4" poster="/media/live-map.jpg" label="Mero Tag's live map with three friends moving around San Francisco" />
        <motion.div className="float-card float-a" animate={{ y: [0, -10, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
          <span className="dot live" /> Ana · just now
        </motion.div>
        <motion.div className="float-card float-b" animate={{ y: [0, 10, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
          <Icon name="battery" size={16} /> Luka · 63%
        </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
}
