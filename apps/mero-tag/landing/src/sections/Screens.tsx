import { Phone } from "../components/Phone";
import { Reveal } from "../components/Reveal";

const screens = [
  {
    id: "live-map",
    title: "One live map",
    body: "Everyone in your space on a full-screen map. Tap a person to fly to them; mint rings pulse while they're live.",
  },
  {
    id: "share",
    title: "Share in two taps",
    body: "Name a tracker for this phone and start sharing. Stop whenever you like — your position stops leaving the phone.",
  },
  {
    id: "invite",
    title: "Invite with a link",
    body: "Send a link that works for 24 hours. People join with their own account; you see who's online.",
  },
  {
    id: "signin",
    title: "Cloud or your own node",
    body: "Sign in with Calimero Cloud and a passkey — or tap “Manually enter node URL” and use a node you run.",
  },
];

export function Screens() {
  return (
    <section className="section" id="screens">
      <Reveal>
        <p className="eyebrow center">The app</p>
        <h2 className="center">Recorded from the real thing.</h2>
        <p className="sub center">Every clip below is a screen recording of the iOS app running against a local Calimero node.</p>
      </Reveal>
      <div className="screens">
        {screens.map((screen, i) => (
          <Reveal key={screen.id} delay={(i % 2) * 0.1} className={`screen ${i % 2 ? "flip" : ""}`}>
            <Phone src={`/media/${screen.id}.mp4`} poster={`/media/${screen.id}.jpg`} label={screen.title} />
            <div className="screen-copy">
              <span className="step">0{i + 1}</span>
              <h3>{screen.title}</h3>
              <p>{screen.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
