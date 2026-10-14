import type { SettingsView } from "./generated/HyperfeedClient";

/**
 * Which of your agents works in which app (the contract's `assignments`), as
 * mero-bot reads it (`src/hyperfeed/assignments.ts` there; change both or
 * neither). An app you did not assign is your private agents': those whose
 * every reported model is attested. With none reporting in, any agent takes it.
 */

/** Code: the tools on a computer (shell, files, git), filed as the app "mero-bot". */
export const CODE_APP = "mero-bot";

type Assigning = Pick<SettingsView, "assignments" | "reach">;

/** The agents that report only attested models: your private ones. */
export function privateAgents(settings: Assigning): string[] {
  return (settings.reach ?? [])
    .filter((r) => r.lines.length > 0 && r.lines.every((l) => l.attested))
    .map((r) => r.agent)
    .sort();
}

/** The agent you assigned `app` to, or "" for the default. */
export function assignedAgent(settings: Assigning, app: string): string {
  return (settings.assignments ?? []).find((a) => a.app === app)?.agent ?? "";
}
