import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const FPS = 30;
const s = (seconds: number) => Math.round(seconds * FPS);

// Scene timing, in seconds.
const T = {
  title: [0, 4],
  scan: [4, 11],
  build: [11, 22],
  room: [22, 31],
  sync: [31, 38],
  invite: [38, 45],
  end: [45, 51],
} as const;
export const DURATION = s(T.end[1]);

const font = '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';
const C = {
  bg: "#05050a",
  violet: "#8b5cf6",
  indigo: "#6366f1",
  cyan: "#22d3ee",
  pink: "#f472b6",
  amber: "#fbbf24",
  green: "#34d399",
  text: "#ffffff",
  dim: "rgba(255,255,255,0.7)",
  faint: "rgba(255,255,255,0.45)",
  glass: "rgba(255,255,255,0.07)",
  stroke: "rgba(255,255,255,0.16)",
};
const aurora = `linear-gradient(120deg, ${C.violet}, ${C.indigo} 45%, ${C.cyan})`;

const useVertical = () => {
  const { width, height } = useVideoConfig();
  return height > width;
};

/** 0 → 1 with a soft spring, starting at `delay` frames. */
const useIn = (delay = 0, damping = 18) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, stiffness: 90 } });
};

/** Fade a scene in and out at its edges. */
const SceneFade: React.FC<{ length: number; children: React.ReactNode }> = ({ length, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10, length - 12, length], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

// ── Backdrop ──────────────────────────────────────────────────────────────

const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 60;
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: 1400,
          height: 1400,
          borderRadius: "50%",
          background: C.violet,
          filter: "blur(160px)",
          opacity: 0.45,
          left: -500 + drift,
          top: -800,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1100,
          height: 1100,
          borderRadius: "50%",
          background: C.cyan,
          filter: "blur(180px)",
          opacity: 0.25,
          right: -450 - drift,
          bottom: -600,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "-50%",
          right: "-50%",
          bottom: -200,
          height: "70%",
          backgroundImage: `linear-gradient(${C.stroke} 1px, transparent 1px), linear-gradient(90deg, ${C.stroke} 1px, transparent 1px)`,
          backgroundSize: "90px 90px",
          backgroundPosition: `0 ${frame * 1.2}px`,
          transform: "perspective(700px) rotateX(64deg)",
          transformOrigin: "bottom",
          maskImage: "linear-gradient(to top, black, transparent 85%)",
          opacity: 0.55,
        }}
      />
    </AbsoluteFill>
  );
};

// ── Pieces ────────────────────────────────────────────────────────────────

const Mark: React.FC<{ size: number }> = ({ size }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.3,
      background: aurora,
      display: "grid",
      placeItems: "center",
      boxShadow: `0 ${size * 0.15}px ${size * 0.6}px -${size * 0.15}px rgba(139,92,246,0.9)`,
      border: "1px solid rgba(255,255,255,0.35)",
    }}
  >
    <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.7} strokeLinejoin="round">
      <path d="M12 2.8 20 7.3v9.4L12 21.2 4 16.7V7.3z" fill="rgba(255,255,255,0.15)" />
      <path d="M4 7.3 12 12l8-4.7M12 12v9.2" />
    </svg>
  </div>
);

const Caption: React.FC<{ eyebrow: string; title: string; body?: string; delay?: number; align?: "left" | "center" }> = ({
  eyebrow,
  title,
  body,
  delay = 6,
  align = "left",
}) => {
  const vertical = useVertical();
  const a = useIn(delay);
  const b = useIn(delay + 6);
  const c = useIn(delay + 12);
  return (
    <div style={{ fontFamily: font, color: C.text, textAlign: align, display: "grid", gap: vertical ? 22 : 26 }}>
      <div
        style={{
          fontSize: vertical ? 30 : 26,
          fontWeight: 700,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "#a5b4fc",
          opacity: a,
          transform: `translateY(${(1 - a) * 20}px)`,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          fontSize: vertical ? 82 : 86,
          fontWeight: 900,
          letterSpacing: "-0.04em",
          lineHeight: 1.02,
          opacity: b,
          transform: `translateY(${(1 - b) * 30}px)`,
        }}
      >
        {title}
      </div>
      {body ? (
        <div
          style={{
            fontSize: vertical ? 36 : 32,
            lineHeight: 1.45,
            color: C.dim,
            maxWidth: vertical ? 900 : 720,
            justifySelf: align === "center" ? "center" : "start",
            opacity: c,
            transform: `translateY(${(1 - c) * 24}px)`,
          }}
        >
          {body}
        </div>
      ) : null}
    </div>
  );
};

const Chip: React.FC<{ children: React.ReactNode; delay: number; color?: string }> = ({ children, delay, color = C.green }) => {
  const vertical = useVertical();
  const p = useIn(delay, 14);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        padding: vertical ? "18px 26px" : "16px 24px",
        borderRadius: 999,
        background: C.glass,
        border: `1px solid ${C.stroke}`,
        backdropFilter: "blur(20px)",
        fontFamily: font,
        fontWeight: 600,
        fontSize: vertical ? 32 : 28,
        color: C.text,
        opacity: p,
        transform: `translateY(${(1 - p) * 26}px) scale(${0.9 + p * 0.1})`,
      }}
    >
      <span style={{ width: 14, height: 14, borderRadius: 7, background: color, boxShadow: `0 0 16px ${color}` }} />
      {children}
    </div>
  );
};

const Phone: React.FC<{ src: string; startFrom: number; delay?: number; scale?: number }> = ({ src, startFrom, delay = 0, scale = 1 }) => {
  const frame = useCurrentFrame();
  const p = useIn(delay, 16);
  const tilt = interpolate(frame, [0, 300], [8, -4]);
  const h = 860 * scale;
  return (
    <div
      style={{
        height: h,
        aspectRatio: "9 / 19.5",
        borderRadius: h * 0.09,
        padding: h * 0.018,
        background: "linear-gradient(160deg, #2a2840, #0b0b12)",
        boxShadow: "0 60px 160px -40px rgba(99,102,241,0.85), inset 0 0 0 2px rgba(255,255,255,0.16)",
        transform: `perspective(1600px) rotateY(${tilt}deg) translateY(${(1 - p) * 80}px) scale(${0.92 + p * 0.08})`,
        opacity: p,
      }}
    >
      <div style={{ width: "100%", height: "100%", borderRadius: h * 0.075, overflow: "hidden", background: "#000" }}>
        <OffthreadVideo src={staticFile(src)} startFrom={startFrom} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    </div>
  );
};

const IllustrationTag: React.FC = () => (
  <div
    style={{
      position: "absolute",
      top: 40,
      right: 48,
      fontFamily: font,
      fontSize: 22,
      fontWeight: 600,
      color: C.faint,
      padding: "8px 16px",
      borderRadius: 999,
      border: `1px solid ${C.stroke}`,
      background: "rgba(0,0,0,0.25)",
    }}
  >
    Illustration
  </div>
);

// ── Scenes ────────────────────────────────────────────────────────────────

const Title: React.FC = () => {
  const vertical = useVertical();
  const frame = useCurrentFrame();
  const m = useIn(4, 12);
  const t = useIn(14);
  const sub = useIn(26);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: font, color: C.text }}>
      <div style={{ display: "grid", justifyItems: "center", gap: 40, textAlign: "center" }}>
        <div style={{ transform: `scale(${m}) rotate(${(1 - m) * -40}deg)` }}>
          <Mark size={vertical ? 220 : 190} />
        </div>
        <div
          style={{
            fontSize: vertical ? 170 : 180,
            fontWeight: 900,
            letterSpacing: "-0.05em",
            opacity: t,
            transform: `translateY(${(1 - t) * 40}px)`,
          }}
        >
          Mero AR
        </div>
        <div
          style={{
            fontSize: vertical ? 54 : 52,
            fontWeight: 600,
            color: C.dim,
            opacity: sub,
            letterSpacing: "-0.01em",
          }}
        >
          Build in your room.{" "}
          <span style={{ background: aurora, WebkitBackgroundClip: "text", color: "transparent" }}>Together.</span>
        </div>
      </div>
      <div style={{ position: "absolute", bottom: 60, fontSize: 24, color: C.faint, opacity: interpolate(frame, [40, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        Collaborative AR, peer to peer, on Calimero
      </div>
    </AbsoluteFill>
  );
};

/** A stylised room being scanned by a phone: motion graphics, not a recording. */
const Scan: React.FC = () => {
  const vertical = useVertical();
  const frame = useCurrentFrame();
  const sweep = interpolate(frame, [20, 150], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const phoneX = interpolate(frame, [0, 200], [-120, 160]);
  const room = (
    <div style={{ position: "relative", width: vertical ? 900 : 1000, height: vertical ? 760 : 640 }}>
      <svg viewBox="0 0 1000 640" width="100%" height="100%">
        <defs>
          <linearGradient id="au" x1="0" x2="1">
            <stop offset="0" stopColor={C.violet} />
            <stop offset="1" stopColor={C.cyan} />
          </linearGradient>
          <clipPath id="swept">
            <rect x="0" y="0" width={1000 * sweep} height="640" />
          </clipPath>
        </defs>
        {/* floor */}
        <path d="M80 600 L920 600 L760 330 L240 330 Z" fill="rgba(255,255,255,0.03)" stroke={C.stroke} strokeWidth="2" />
        {/* back wall + window */}
        <path d="M240 330 L760 330 L760 60 L240 60 Z" fill="rgba(255,255,255,0.025)" stroke={C.stroke} strokeWidth="2" />
        <rect x="530" y="110" width="160" height="130" rx="10" fill="rgba(34,211,238,0.06)" stroke={C.stroke} strokeWidth="2" />
        {/* sofa + table silhouettes */}
        <rect x="290" y="250" width="230" height="90" rx="22" fill="rgba(255,255,255,0.06)" stroke={C.stroke} strokeWidth="2" />
        <rect x="560" y="420" width="190" height="70" rx="14" fill="rgba(255,255,255,0.06)" stroke={C.stroke} strokeWidth="2" />
        {/* the scan mesh, revealed by the sweep */}
        <g clipPath="url(#swept)" stroke="url(#au)" strokeWidth="2.2" fill="none" opacity="0.9">
          {Array.from({ length: 9 }).map((_, i) => (
            <path key={`h${i}`} d={`M${80 + i * 20} ${600 - i * 30} L${920 - i * 20} ${600 - i * 30}`} />
          ))}
          {Array.from({ length: 11 }).map((_, i) => (
            <path key={`v${i}`} d={`M${80 + i * 84} 600 L${240 + i * 52} 330`} />
          ))}
          <rect x="290" y="250" width="230" height="90" rx="22" />
          <rect x="560" y="420" width="190" height="70" rx="14" />
        </g>
        {/* placed objects popping in after the scan */}
        {[
          { x: 380, y: 230, c: C.violet, d: 150, r: 0 },
          { x: 650, y: 400, c: C.cyan, d: 168, r: 1 },
          { x: 470, y: 520, c: C.pink, d: 186, r: 2 },
        ].map((o) => {
          const p = spring({ frame: frame - o.d, fps: FPS, config: { damping: 11, stiffness: 120 } });
          return o.r === 1 ? (
            <circle key={o.x} cx={o.x} cy={o.y} r={34 * p} fill={o.c} />
          ) : (
            <rect key={o.x} x={o.x - 32 * p} y={o.y - 32 * p} width={64 * p} height={64 * p} rx="10" fill={o.c} transform={`rotate(${o.r ? 0 : 12} ${o.x} ${o.y})`} />
          );
        })}
      </svg>
      {/* the phone, moving across */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "18%",
          transform: `translateX(${phoneX}px) rotate(-6deg)`,
          width: 150,
          height: 300,
          borderRadius: 30,
          border: "3px solid rgba(255,255,255,0.7)",
          background: "rgba(139,92,246,0.12)",
          boxShadow: "0 30px 80px -20px rgba(34,211,238,0.6)",
        }}
      >
        <div style={{ position: "absolute", inset: 10, borderRadius: 22, border: `2px dashed ${C.cyan}`, opacity: 0.7 }} />
      </div>
    </div>
  );
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <IllustrationTag />
      <div style={{ display: "flex", flexDirection: vertical ? "column" : "row", alignItems: "center", gap: vertical ? 80 : 90, padding: vertical ? "0 60px" : "0 110px" }}>
        <div style={{ flex: vertical ? undefined : "0 0 640px" }}>
          <Caption eyebrow="01 · Scan" title="Scan the room." body="ARKit maps your space. Share the scan, and everyone's device lines up in the same room." align={vertical ? "center" : "left"} />
        </div>
        {room}
      </div>
    </AbsoluteFill>
  );
};

const Build: React.FC = () => {
  const vertical = useVertical();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: vertical ? "column" : "row", alignItems: "center", gap: vertical ? 70 : 140, padding: vertical ? "0 60px" : "0 140px" }}>
        <Phone src="clip-room.mp4" startFrom={s(5.5)} scale={vertical ? 1.05 : 1.04} />
        <div style={{ display: "grid", gap: 44, maxWidth: 820 }}>
          <Caption eyebrow="02 · Build" title="Place it. Together." body="Cubes, spheres, labels and notes. Move, turn, paint and lock them, and everyone sees it at once." align={vertical ? "center" : "left"} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: vertical ? "center" : "flex-start" }}>
            <Chip delay={40}>Leo joined from his node</Chip>
            <Chip delay={70} color={C.pink}>Leo placed a sphere</Chip>
            <Chip delay={100} color={C.amber}>Note: Plant goes by the window</Chip>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** A floor plan drawing itself, then rising into walls and furniture: an
 *  illustration of a RoomPlan scan (labelled), not a recording. */
const ScanIllustration: React.FC = () => {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [6, 70], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rise = interpolate(frame, [70, 120], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const tilt = 58 * rise;
  const walls = 90 * rise;
  return (
    <div style={{ position: "relative", width: 520, height: 420, perspective: 1100 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `rotateX(${tilt}deg) rotateZ(${-24 * rise}deg)`,
          transformStyle: "preserve-3d",
          transformOrigin: "50% 60%",
        }}
      >
        <svg viewBox="0 0 520 420" width="520" height="420" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          <rect x="40" y="40" width="440" height="340" rx="6" fill="rgba(139,92,246,0.12)" stroke={C.cyan} strokeWidth="5"
            pathLength={1} strokeDasharray="1" strokeDashoffset={1 - draw} />
          {[
            { x: 160, y: 300, w: 200, h: 60, l: "Sofa" },
            { x: 200, y: 200, w: 120, h: 60, l: "Table" },
            { x: 170, y: 52, w: 180, h: 40, l: "Storage" },
          ].map((f, i) => {
            const p = interpolate(frame, [40 + i * 10, 60 + i * 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return (
              <g key={f.l} opacity={p}>
                <rect x={f.x} y={f.y} width={f.w} height={f.h} rx="12" fill="rgba(165,180,252,0.35)" stroke="rgba(255,255,255,0.6)" strokeWidth="2" />
                <text x={f.x + f.w / 2} y={f.y + f.h / 2 + 7} textAnchor="middle" fill={C.text} fontSize="20" fontWeight="700" fontFamily={font}>
                  {f.l}
                </text>
              </g>
            );
          })}
        </svg>
        {/* walls rising out of the plan */}
        {[
          { left: 40, top: 40, width: 440, rot: 0 },
          { left: 40, top: 40, width: 340, rot: 90 },
          { left: 480, top: 40, width: 340, rot: 90 },
        ].map((w, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: w.left,
              top: w.top,
              width: w.width,
              height: 110,
              transformOrigin: "0 0",
              transform: `rotateZ(${w.rot}deg) rotateX(${-walls}deg)`,
              background: "linear-gradient(180deg, rgba(220,220,245,0.55), rgba(139,92,246,0.25))",
              borderTop: `3px solid ${C.cyan}`,
              opacity: rise,
            }}
          />
        ))}
      </div>
    </div>
  );
};

const RoomScene: React.FC = () => {
  const vertical = useVertical();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: vertical ? "column" : "row", alignItems: "center", gap: vertical ? 50 : 100, padding: vertical ? "0 60px" : "0 120px" }}>
        <div style={{ display: "grid", gap: 34, maxWidth: 760, justifyItems: vertical ? "center" : "start" }}>
          <Caption eyebrow="03 · Your room" title="Your room, in 3D." body="Scan it with a LiDAR iPhone. Share it with the room. Decorate it together, on any device." align={vertical ? "center" : "left"} />
          <div style={{ position: "relative", transform: vertical ? "scale(0.8)" : "scale(0.85)", transformOrigin: vertical ? "50% 0" : "0 0" }}>
            <ScanIllustration />
            <div style={{ position: "absolute", top: -6, left: 0, fontFamily: font, fontSize: 20, fontWeight: 600, color: C.faint, padding: "6px 14px", borderRadius: 999, border: `1px solid ${C.stroke}`, background: "rgba(0,0,0,0.3)" }}>
              Illustration · scanning with RoomPlan
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gap: 18, justifyItems: "center" }}>
          <Phone src="clip-scan.mp4" startFrom={s(8)} scale={vertical ? 0.95 : 1.0} delay={20} />
          <Chip delay={60} color={C.cyan}>Sample room · real app recording</Chip>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Sync: React.FC = () => {
  const vertical = useVertical();
  const frame = useCurrentFrame();
  const devices = [
    { x: 160, label: "Maya's phone", sub: "her node", c: C.violet },
    { x: 500, label: "Leo's iPad", sub: "his node", c: C.cyan },
    { x: 840, label: "Sam's phone", sub: "Cloud node", c: C.pink },
  ];
  const draw = interpolate(frame, [10, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: font }}>
      <div style={{ display: "grid", justifyItems: "center", gap: vertical ? 90 : 60, padding: "0 80px" }}>
        <Caption eyebrow="04 · Sync" title="No server in the middle." body="Every device talks to its own node. The room is a CRDT the nodes sync peer to peer." align="center" />
        <svg viewBox="0 0 1000 340" width={vertical ? 960 : 1300}>
          <rect x="360" y="240" width="280" height="84" rx="24" fill="rgba(139,92,246,0.16)" stroke={C.violet} strokeWidth="2.5" />
          <text x="500" y="276" textAnchor="middle" fill={C.text} fontSize="22" fontWeight="800" fontFamily={font}>
            Room state
          </text>
          <text x="500" y="304" textAnchor="middle" fill={C.faint} fontSize="16" fontFamily={font}>
            objects · locks · notes · roles · scan
          </text>
          {devices.map((d, i) => {
            const t = ((frame + i * 22) % 70) / 70;
            const x = d.x + (500 - d.x) * t;
            const y = 120 + (240 - 120) * t;
            return (
              <g key={d.label}>
                <path d={`M${d.x} 120 Q ${(d.x + 500) / 2} 190 500 240`} stroke={d.c} strokeWidth="2.5" fill="none" strokeDasharray="7 9" pathLength={1} strokeDashoffset={1 - draw} opacity={0.85} />
                <circle cx={x} cy={y} r="8" fill={d.c} opacity={draw} />
                <rect x={d.x - 120} y="30" width="240" height="90" rx="24" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.18)" />
                <text x={d.x} y="70" textAnchor="middle" fill={C.text} fontSize="22" fontWeight="700" fontFamily={font}>
                  {d.label}
                </text>
                <text x={d.x} y="98" textAnchor="middle" fill={C.faint} fontSize="16" fontFamily={font}>
                  {d.sub}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </AbsoluteFill>
  );
};

const Invite: React.FC = () => {
  const vertical = useVertical();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: vertical ? "column-reverse" : "row", alignItems: "center", gap: vertical ? 70 : 140, padding: vertical ? "0 60px" : "0 140px" }}>
        <div style={{ display: "grid", gap: 44, maxWidth: 820 }}>
          <Caption eyebrow="05 · Invite" title="Bring people in." body="Share a signed invite link. Viewers look around; editors build with you." align={vertical ? "center" : "left"} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: vertical ? "center" : "flex-start" }}>
            <Chip delay={40} color={C.cyan}>Admin · Editor · Viewer</Chip>
            <Chip delay={64} color={C.violet}>Share or copy the invite link</Chip>
          </div>
        </div>
        <Phone src="clip-invite.mp4" startFrom={s(1.5)} scale={vertical ? 1.05 : 1.04} />
      </div>
    </AbsoluteFill>
  );
};

const End: React.FC = () => {
  const vertical = useVertical();
  const m = useIn(4, 14);
  const t = useIn(14);
  const u = useIn(26);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: font, color: C.text, textAlign: "center" }}>
      <div style={{ display: "grid", justifyItems: "center", gap: 36 }}>
        <div style={{ transform: `scale(${m})` }}>
          <Mark size={150} />
        </div>
        <div style={{ fontSize: vertical ? 96 : 110, fontWeight: 900, letterSpacing: "-0.045em", opacity: t, transform: `translateY(${(1 - t) * 30}px)` }}>
          Make a room worth sharing.
        </div>
        <div style={{ fontSize: vertical ? 38 : 36, color: C.dim, opacity: u }}>Open source · built on Calimero</div>
        <div
          style={{
            marginTop: 10,
            padding: "18px 34px",
            borderRadius: 999,
            background: aurora,
            fontSize: vertical ? 34 : 32,
            fontWeight: 700,
            opacity: u,
            boxShadow: "0 20px 60px -15px rgba(139,92,246,0.9)",
          }}
        >
          github.com/calimero-network/mero-ar
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Promo: React.FC = () => {
  const scenes: [readonly [number, number], React.FC][] = [
    [T.title, Title],
    [T.scan, Scan],
    [T.build, Build],
    [T.room, RoomScene],
    [T.sync, Sync],
    [T.invite, Invite],
    [T.end, End],
  ];
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Backdrop />
      {scenes.map(([[from, to], Scene]) => (
        <Sequence key={from} from={s(from)} durationInFrames={s(to - from)}>
          <SceneFade length={s(to - from)}>
            <Scene />
          </SceneFade>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
