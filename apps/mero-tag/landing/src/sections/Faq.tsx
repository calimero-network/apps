import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Reveal } from "../components/Reveal";

const faqs = [
  ["Do I need my own server?", "No. Sign in with Calimero Cloud and your account gets a hosted relay node. If you'd rather keep everything on your own hardware, run a node and use “Manually enter node URL”."],
  ["Does Mero Tag sell or analyse my location?", "There is no Mero Tag company server collecting locations. Your space's data lives on the nodes of the space — the relay serving your account, or your own node."],
  ["Is it end-to-end encrypted?", "Not in the sense that the node can't read it: the node running your space executes its logic and holds its state. Traffic to it uses HTTPS on hosted relays."],
  ["Who can see me?", "Everyone in the space you're sharing into. Invite only people you'd trust with your location, and stop sharing whenever you like."],
  ["Does it work in the background?", "Yes, with “Always” location permission it keeps sending while the app is in the background. You can stop sharing from the Map tab."],
  ["Is it on Android?", "Not yet. The app is SwiftUI on iOS 17+; the contract and the Calimero SDKs it uses also exist for Android."],
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="section narrow" id="faq">
      <Reveal>
        <p className="eyebrow center">FAQ</p>
        <h2 className="center">Questions, answered.</h2>
      </Reveal>
      <div className="faq">
        {faqs.map(([q, a], i) => (
          <Reveal key={q} delay={i * 0.04}>
            <div className={`faq-item ${open === i ? "open" : ""}`}>
              <button aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                {q}
                <span aria-hidden>{open === i ? "−" : "+"}</span>
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28 }}>
                    {a}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
