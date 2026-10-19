import { MotionConfig } from "framer-motion";
import { Faq } from "./sections/Faq";
import { Features } from "./sections/Features";
import { Film } from "./sections/Film";
import { Footer } from "./sections/Footer";
import { Hero } from "./sections/Hero";
import { HowItWorks } from "./sections/HowItWorks";
import { Nav } from "./sections/Nav";
import { Privacy } from "./sections/Privacy";
import { Screens } from "./sections/Screens";

export function App() {
  return (
    // "user": framer-motion follows the OS's reduce-motion setting.
    <MotionConfig reducedMotion="user">
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <Screens />
        <Features />
        <Film />
        <Privacy />
        <Faq />
      </main>
      <Footer />
    </MotionConfig>
  );
}
