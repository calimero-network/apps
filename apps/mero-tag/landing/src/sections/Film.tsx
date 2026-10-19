import { Reveal } from "../components/Reveal";

export function Film() {
  return (
    <section className="section" id="film">
      <Reveal>
        <p className="eyebrow center">The film</p>
        <h2 className="center">Forty seconds of Mero Tag.</h2>
      </Reveal>
      <Reveal delay={0.1} className="film">
        <video src="/media/promo.mp4" poster="/media/promo.jpg" controls playsInline preload="none" aria-label="Mero Tag promotional film" />
      </Reveal>
      <p className="note center">
        Made from the app's real screen recordings. Also as a <a href="/media/promo-vertical.mp4">vertical cut</a> for
        stories and reels.
      </p>
    </section>
  );
}
