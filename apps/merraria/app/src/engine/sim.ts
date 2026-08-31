// Shared day/night cycle — identical maths to mero-blocks: derived from the
// world's creation timestamp, so every peer sees the same sun for free.

export const DAY_LENGTH_SECS = 600;

export function dayPhase(elapsedSecs: number): number {
  const p = (elapsedSecs % DAY_LENGTH_SECS) / DAY_LENGTH_SECS;
  return p < 0 ? p + 1 : p;
}

export function dayFactor(elapsedSecs: number): number {
  const p = dayPhase(elapsedSecs);
  const sun = Math.cos((p - 0.25) * Math.PI * 2) * 0.5 + 0.5;
  return 0.08 + Math.pow(sun, 0.6) * 0.92;
}

/** [top, bottom] sky gradient colors as css strings */
export function skyGradient(elapsedSecs: number): [string, string] {
  const f = (dayFactor(elapsedSecs) - 0.08) / 0.92;
  const mix = (a: number[], b: number[]) =>
    `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(",")})`;
  return [mix([4, 6, 20], [96, 165, 220]), mix([10, 12, 28], [170, 215, 240])];
}

/** sun/moon position across the screen: x 0..1, y arc 0..1 (1 = horizon) */
export function celestialPos(elapsedSecs: number): { x: number; y: number; isSun: boolean } {
  const p = dayPhase(elapsedSecs);
  const isSun = p < 0.5;
  const t = isSun ? p * 2 : (p - 0.5) * 2; // 0..1 across its half of the day
  return { x: t, y: 1 - Math.sin(t * Math.PI), isSun };
}
