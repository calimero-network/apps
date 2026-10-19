/**
 * Mero Tag's promo: the app's real screen recordings (landing/public/media)
 * in a phone frame, with animated captions and the brand's indigo→violet
 * light. Scenes are listed in SCENES; each picks a recording and the second to
 * start it from. Rendered 16:9 and 9:16 from the same timeline.
 */
import React from "react";
import {
  AbsoluteFill,
  Easing,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const FPS = 30;
export const DURATION = 40;

const ACCENT = "#5B4BFF";
const VIOLET = "#9B5CFF";
const LIVE = "#14C99A";
const INK = "#0D0F1A";
const SANS = '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';
const ROUNDED = '"SF Pro Rounded", ui-rounded, -apple-system, "SF Pro Display", sans-serif';

type Scene = { from: number; to: number; clip: string; start: number; eyebrow: string; title: string; body: string };

const SCENES: Scene[] = [
  { from: 4, to: 11, clip: "signin", start: 0, eyebrow: "Sign in", title: "Your passkey.\nOr your own node.", body: "Calimero Cloud approves this phone once. Or point the app at a node you run." },
  { from: 11, to: 21, clip: "live-map", start: 1, eyebrow: "Live map", title: "Everyone you love,\non one map.", body: "Positions arrive as live events. Tap a friend to fly to them." },
  { from: 21, to: 29, clip: "share", start: 5, eyebrow: "Share", title: "Two taps to share.\nOne to stop.", body: "Name this phone, start sharing — and stop whenever you like." },
  { from: 29, to: 35, clip: "invite", start: 2, eyebrow: "Invite", title: "Bring them in\nwith a link.", body: "Invites work for a day. People join with their own account." },
];

const ease = Easing.bezier(0.22, 1, 0.36, 1);

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  return (
    <AbsoluteFill style={{ background: "#0A0B12", overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 1400, height: 1400, borderRadius: "50%", left: -300 + Math.sin(t / 5) * 120, top: -500 + Math.cos(t / 6) * 80, background: `radial-gradient(circle, ${ACCENT}66, transparent 60%)`, filter: "blur(60px)" }} />
      <div style={{ position: "absolute", width: 1200, height: 1200, borderRadius: "50%", right: -400 + Math.cos(t / 4) * 120, bottom: -600, background: `radial-gradient(circle, ${VIOLET}55, transparent 60%)`, filter: "blur(70px)" }} />
      <div style={{ position: "absolute", width: 900, height: 900, borderRadius: "50%", left: "40%", bottom: -500, background: `radial-gradient(circle, ${LIVE}33, transparent 60%)`, filter: "blur(80px)" }} />
    </AbsoluteFill>
  );
};

const Radar: React.FC<{ size: number }> = ({ size }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", width: size, height: size }}>
      {[0, 1, 2, 3].map((i) => {
        const p = ((frame / FPS + i * 0.9) % 3.6) / 3.6;
        return (
          <div key={i} style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `2px solid ${ACCENT}`, opacity: (1 - p) * 0.7, transform: `scale(${0.3 + p * 1.4})` }} />
        );
      })}
    </div>
  );
};

const Mark: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ width: size, height: size, borderRadius: size * 0.3, background: `linear-gradient(135deg, ${ACCENT}, ${VIOLET})`, display: "grid", placeItems: "center", boxShadow: `0 ${size * 0.2}px ${size * 0.6}px ${ACCENT}88` }}>
    <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24">
      <path d="M20.5 3.5 2.5 11l8 2.5 2.5 8z" fill="#fff" />
    </svg>
  </div>
);

const Phone: React.FC<{ clip: string; start: number; height: number }> = ({ clip, start, height }) => {
  const width = height * (720 / 1560);
  return (
    <div style={{ width, height, borderRadius: height * 0.075, padding: height * 0.016, background: "linear-gradient(160deg,#2A2D44,#0B0C14)", boxShadow: "0 60px 120px rgba(0,0,0,.55), inset 0 0 0 3px rgba(255,255,255,.08)" }}>
      <div style={{ width: "100%", height: "100%", borderRadius: height * 0.06, overflow: "hidden", background: "#000" }}>
        <OffthreadVideo src={staticFile(`media/${clip}.mp4`)} startFrom={Math.round(start * FPS)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    </div>
  );
};

const Title: React.FC<{ vertical: boolean }> = ({ vertical }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 14 } });
  const lines = ["Find your people.", "Privately."];
  const out = interpolate(frame, [3.4 * FPS, 4 * FPS], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: out }}>
      <Radar size={vertical ? 900 : 760} />
      <div style={{ transform: `scale(${pop})`, marginBottom: 48 }}>
        <Mark size={vertical ? 180 : 150} />
      </div>
      {lines.map((line, i) => {
        const p = interpolate(frame, [(0.4 + i * 0.25) * FPS, (1.1 + i * 0.25) * FPS], [0, 1], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={line} style={{ fontFamily: ROUNDED, fontWeight: 800, fontSize: vertical ? 120 : 110, letterSpacing: -4, lineHeight: 1.05, color: i ? "transparent" : "#fff", backgroundImage: i ? `linear-gradient(110deg, ${ACCENT}, ${VIOLET} 55%, ${LIVE})` : undefined, WebkitBackgroundClip: i ? "text" : undefined, opacity: p, transform: `translateY(${(1 - p) * 40}px)`, textAlign: "center" }}>
            {line}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const SceneView: React.FC<{ scene: Scene; vertical: boolean }> = ({ scene, vertical }) => {
  const frame = useCurrentFrame();
  const length = (scene.to - scene.from) * FPS;
  const enter = interpolate(frame, [0, 0.7 * FPS], [0, 1], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const exit = interpolate(frame, [length - 0.5 * FPS, length], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const textIn = (d: number) => interpolate(frame, [d * FPS, (d + 0.6) * FPS], [0, 1], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const drift = interpolate(frame, [0, length], [0, -16]);

  const copy = (
    <div style={{ maxWidth: vertical ? 900 : 820, textAlign: vertical ? "center" : "left" }}>
      <div style={{ opacity: textIn(0.15), fontFamily: SANS, fontWeight: 700, fontSize: 30, letterSpacing: 5, textTransform: "uppercase", color: "#A99EFF", marginBottom: 22 }}>{scene.eyebrow}</div>
      <div style={{ opacity: textIn(0.3), transform: `translateY(${(1 - textIn(0.3)) * 30}px)`, fontFamily: ROUNDED, fontWeight: 800, fontSize: vertical ? 96 : 80, letterSpacing: -3, lineHeight: 1.04, color: "#fff", whiteSpace: "pre-line" }}>{scene.title}</div>
      <div style={{ opacity: textIn(0.55), transform: `translateY(${(1 - textIn(0.55)) * 20}px)`, fontFamily: SANS, fontSize: vertical ? 40 : 34, lineHeight: 1.4, color: "#C9CCDB", marginTop: 28 }}>{scene.body}</div>
    </div>
  );
  const phone = (
    <div style={{ transform: `translateY(${(1 - enter) * 120 + drift}px) rotate(${(1 - enter) * -6}deg)`, opacity: enter }}>
      <Phone clip={scene.clip} start={scene.start} height={vertical ? 1180 : 900} />
    </div>
  );
  return (
    <AbsoluteFill style={{ opacity: exit, flexDirection: vertical ? "column" : "row", alignItems: "center", justifyContent: "center", gap: vertical ? 70 : 140, padding: vertical ? "120px 80px" : "0 140px" }}>
      {vertical ? (
        <>
          {copy}
          {phone}
        </>
      ) : (
        <>
          {phone}
          {copy}
        </>
      )}
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ vertical: boolean }> = ({ vertical }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 16 } });
  const line = (d: number) => interpolate(frame, [d * FPS, (d + 0.6) * FPS], [0, 1], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: 80 }}>
      <Radar size={vertical ? 900 : 700} />
      <div style={{ transform: `scale(${p})`, marginBottom: 40 }}>
        <Mark size={vertical ? 160 : 130} />
      </div>
      <div style={{ opacity: line(0.3), fontFamily: ROUNDED, fontWeight: 800, fontSize: vertical ? 100 : 92, letterSpacing: -3, color: "#fff", lineHeight: 1.05 }}>
        No tracking company
        <br />
        in the middle.
      </div>
      <div style={{ opacity: line(0.9), fontFamily: SANS, fontSize: vertical ? 40 : 34, color: "#C9CCDB", marginTop: 34 }}>
        Mero Tag · built on Calimero
      </div>
      <div style={{ opacity: line(1.3), marginTop: 30, fontFamily: SANS, fontWeight: 600, fontSize: vertical ? 34 : 30, color: INK, background: "#fff", padding: "16px 30px", borderRadius: 20 }}>
        github.com/calimero-network/mero-tag
      </div>
    </AbsoluteFill>
  );
};

export const Promo: React.FC<{ vertical: boolean }> = ({ vertical }) => (
  <AbsoluteFill style={{ fontFamily: SANS }}>
    <Background />
    <Sequence durationInFrames={4 * FPS}>
      <Title vertical={vertical} />
    </Sequence>
    {SCENES.map((scene) => (
      <Sequence key={scene.clip} from={scene.from * FPS} durationInFrames={(scene.to - scene.from) * FPS}>
        <SceneView scene={scene} vertical={vertical} />
      </Sequence>
    ))}
    <Sequence from={35 * FPS} durationInFrames={5 * FPS}>
      <Outro vertical={vertical} />
    </Sequence>
  </AbsoluteFill>
);
