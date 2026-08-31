// Deterministic, unique-per-project thumbnail. Each context id maps to a stable
// colourful gradient "mesh" so every project card looks distinct (and the same
// every time) without fetching board contents. The class passed in supplies
// sizing + the slow drift animation (see ProjectsPage.module.css .cardThumb).

function hashSeed(s: string): number {
  // FNV-1a — cheap, well-distributed, stable across reloads.
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

interface Props {
  seed: string;
  className?: string;
}

export default function ProjectThumbnail({ seed, className }: Props) {
  const h = hashSeed(seed || "merodesign");
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + (h % 90)) % 360;
  const hue3 = (hue1 + 180 + ((h >> 5) % 60)) % 360;
  const ax = h % 100;
  const ay = (h >> 3) % 100;
  const bx = (h >> 7) % 100;
  const by = (h >> 11) % 100;

  const background = [
    `radial-gradient(circle at ${ax}% ${ay}%, hsl(${hue1} 85% 66% / 0.95), transparent 60%)`,
    `radial-gradient(circle at ${bx}% ${by}%, hsl(${hue2} 85% 60% / 0.9), transparent 55%)`,
    `linear-gradient(135deg, hsl(${hue1} 70% 56%), hsl(${hue3} 70% 50%))`,
  ].join(", ");

  return (
    <div
      className={className}
      style={{ background, backgroundSize: "200% 200%" }}
      aria-hidden="true"
    />
  );
}
