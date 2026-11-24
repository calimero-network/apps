import { motion, useScroll, useTransform } from "framer-motion";
import { Icon } from "../components/Icon";

export const GITHUB = "https://github.com/calimero-network/mero-tag";

export function Nav() {
  const { scrollY } = useScroll();
  const shadow = useTransform(scrollY, [0, 80], ["0 0 0 rgba(0,0,0,0)", "0 10px 30px rgba(20,24,60,0.12)"]);
  return (
    <motion.header className="nav" style={{ boxShadow: shadow }}>
      <a className="brand" href="#top" aria-label="Mero Tag home">
        <img src="/icon.svg" alt="" width={30} height={30} />
        <span>Mero Tag</span>
      </a>
      <nav aria-label="Sections">
        <a href="#how">How it works</a>
        <a href="#screens">The app</a>
        <a href="#privacy">Privacy</a>
        <a href="#faq">FAQ</a>
      </nav>
      <a className="btn btn-ghost" href={GITHUB}>
        <Icon name="github" size={18} /> GitHub
      </a>
    </motion.header>
  );
}
