// Fixture data for the screenshot harness. See ../shots.mjs.

export interface Scenario {
  id: string;
  title: string;
  /** Which screen to render. */
  page: "teams" | "rooms";
  /** Open the invite dialog. */
  invite?: boolean;
  /** Render under `data-theme`. Light is the default, so only dark is named. */
  theme?: "dark";
  /** Pretend this app is not installed on the node. */
  notInstalled?: boolean;
  /** Pretend the node has nothing yet. */
  empty?: boolean;
}

export const SCENARIOS: Scenario[] = [
  { id: "teams", title: "Your teams", page: "teams" },
  { id: "teams-empty", title: "No teams yet", page: "teams", empty: true },
  {
    id: "teams-not-installed",
    title: "The app is not installed on this node",
    page: "teams",
    notInstalled: true,
  },
  { id: "rooms", title: "Rooms inside one team", page: "rooms" },
  {
    id: "invite",
    title: "An invitation: link, QR, and the code as a fallback",
    page: "teams",
    invite: true,
  },
  { id: "dark", title: "Dark theme", page: "rooms", theme: "dark" },
];

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
