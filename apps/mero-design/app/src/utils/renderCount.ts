/**
 * Dev-only render counter for the perf bench (`e2e/perf/`).
 *
 * A wasted re-render is invisible in wall-clock until the board is big enough to
 * hurt, so it needs counting rather than timing: "collapsing a group re-rendered
 * the canvas and the toolbar" is a fact you can act on, where "it took 17ms" is
 * not. `import.meta.env.DEV` is statically false in a production build, so both
 * the call and this module's body are dropped by the bundler.
 */
export function countRender(name: string): void {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __renders?: Record<string, number> };
  const counts = (w.__renders ??= {});
  counts[name] = (counts[name] ?? 0) + 1;
}
