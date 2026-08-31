// Shared day/night cycle: derived from the world's creation timestamp, so
// every peer sees the same sun with zero network traffic.

export const DAY_LENGTH_SECS = 600; // 10 minute full cycle

/** 0..1 position in the day cycle */
export function dayPhase(elapsedSecs: number): number {
  const p = (elapsedSecs % DAY_LENGTH_SECS) / DAY_LENGTH_SECS;
  return p < 0 ? p + 1 : p;
}

/**
 * Sunlight multiplier 0.08..1. Day is phases [0, 0.5), night [0.5, 1),
 * with smooth dawn/dusk ramps.
 */
export function dayFactor(elapsedSecs: number): number {
  const p = dayPhase(elapsedSecs);
  // cosine bump centered on midday (p = 0.25)
  const sun = Math.cos((p - 0.25) * Math.PI * 2) * 0.5 + 0.5; // 1 at midday, 0 at midnight
  const curved = Math.pow(sun, 0.6);
  return 0.08 + curved * 0.92;
}

/** sky color for the current phase, rgb 0..1 */
export function skyColor(elapsedSecs: number): [number, number, number] {
  const f = dayFactor(elapsedSecs);
  const day: [number, number, number] = [0.53, 0.77, 0.92];
  const night: [number, number, number] = [0.02, 0.03, 0.08];
  const t = (f - 0.08) / 0.92;
  return [
    night[0] + (day[0] - night[0]) * t,
    night[1] + (day[1] - night[1]) * t,
    night[2] + (day[2] - night[2]) * t,
  ];
}
