/**
 * The starter projects the Options menu offers. Each is a bundled project file
 * (the same format as Save / Open), imported lazily so none of them weighs on
 * the initial bundle — the web design one alone is ~170 kB.
 */
export type StarterId = "web" | "presentation";

export interface Starter {
  id: StarterId;
  label: string;
  hint: string;
  /** Kept as `open-starter` for the web design one, which predates the others. */
  testId: string;
}

export const STARTERS: Starter[] = [
  { id: "web", label: "Web design", hint: "Five app screens and a design system", testId: "open-starter" },
  { id: "presentation", label: "Presentation", hint: "An 8-slide deck about Calimero — press Present", testId: "open-starter-presentation" },
];

/** The starter's project file, as text. */
export async function loadStarter(id: StarterId): Promise<string> {
  switch (id) {
    case "web":
      return (await import("./starter-project.json?raw")).default;
    case "presentation":
      return (await import("./starter-presentation.json?raw")).default;
  }
}
