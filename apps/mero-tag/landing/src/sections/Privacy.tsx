import { Reveal } from "../components/Reveal";

const rows: [string, string][] = [
  ["People in your space", "Can see every tracker in the space and its latest position, battery and history."],
  ["The node your space runs on", "Holds the space's data, like any node in it. With Calimero Cloud that's a relay Calimero hosts; run your own node to keep it on hardware you control."],
  ["Calimero, the company", "Doesn't run a Mero Tag service that collects locations. If you use Calimero Cloud, it operates the relay node above."],
  ["Anyone else", "Nothing — unless they're added to your space or can reach a node that holds it."],
];

export function Privacy() {
  return (
    <section className="section" id="privacy">
      <Reveal>
        <p className="eyebrow center">Privacy, plainly</p>
        <h2 className="center">Who can see your location.</h2>
        <p className="sub center">No "military-grade" anything. Here's what actually happens to a position.</p>
      </Reveal>
      <Reveal delay={0.1} className="privacy">
        {rows.map(([who, what]) => (
          <div className="privacy-row" key={who}>
            <strong>{who}</strong>
            <span>{what}</span>
          </div>
        ))}
      </Reveal>
      <Reveal delay={0.15}>
        <p className="note center">
          Today every member of a space can read all of its trackers — the per-tracker share list you see in the app isn't
          enforced by the contract yet. Keep a space to people you'd trust with your location.
        </p>
      </Reveal>
    </section>
  );
}
