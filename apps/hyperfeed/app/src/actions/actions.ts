import type { ActionDef, ActionModeView, ActionSetView } from "../generated/HyperfeedClient";
import type { ActionMode } from "../backend";
import type { Abi } from "../lens/validate";

/**
 * An app's actions: the things your agent can do there, in words you would use
 * ("Edit documents"), each covering some of the app's methods.
 *
 * Your agent learns them from the app's ABI and proposes them, the way it
 * proposes a lens; the contract uses them once you approve. Then they decide
 * what each agent call is: whether it writes, the guard that always covers it,
 * and your setting for that action. A method none of them names asks you.
 */

/** How you set one action; "" follows the app's mode. Mirrors the contract's `ACTION_MODES`. */
export const ACTION_MODES: readonly ActionMode[] = ["", "act", "ask", "off"];

/** The guards an action may name. Mirrors the contract's `GUARDS`. */
const CATEGORIES = new Set(["", "sign", "money", "new_contact", "delete", "invite", "secret"]);

/** Methods the agent never calls: the app's constructor. */
const NOT_CALLABLE = new Set(["init"]);

/**
 * Checks actions against the app's ABI before anyone relies on them. The agent
 * that wrote them gets every problem back as one line. What it checks:
 *
 * - every method an action names exists in the app;
 * - a method belongs to one action only;
 * - an action that says it only reads covers no method that changes state;
 * - ids are unique and categories are guards.
 *
 * It does not ask that every method be covered: one no action names asks you
 * every time, which is safe. {@link uncovered} lists them.
 */
export function validateActions(actions: ActionDef[], abi: Abi): string[] {
  const problems: string[] = [];
  if (!Array.isArray(actions) || actions.length === 0) return ["an app needs at least one action"];
  const methods = new Map(abi.methods.map((m) => [m.name, m]));
  const ids = new Set<string>();
  const owner = new Map<string, string>();
  for (const a of actions) {
    const at = (what: string) => `${a.id || "(no id)"}: ${what}`;
    if (!a.id) problems.push(at("needs an id"));
    else if (ids.has(a.id)) problems.push(at("two actions have this id"));
    ids.add(a.id);
    if (!a.label?.trim()) problems.push(at("needs a label"));
    if (!CATEGORIES.has(a.category)) problems.push(at(`${JSON.stringify(a.category)} is not a guard`));
    if (!a.methods?.length) problems.push(at("covers no methods"));
    for (const name of a.methods ?? []) {
      const m = methods.get(name);
      if (!m || NOT_CALLABLE.has(name)) problems.push(at(`${name} is not a method the app has`));
      else if (!a.writes && m.intent !== "read_only") problems.push(at(`${name} changes state, so this action writes`));
      const other = owner.get(name);
      if (other && other !== a.id) problems.push(at(`${name} is already in ${other}`));
      owner.set(name, a.id);
    }
  }
  return problems;
}

/** The app's methods no action names: each asks you every time. */
export function uncovered(actions: ActionDef[], abi: Abi): string[] {
  const named = new Set(actions.flatMap((a) => a.methods));
  return abi.methods.map((m) => m.name).filter((n) => !named.has(n) && !NOT_CALLABLE.has(n));
}

/** Each app's set in force (its newest approved), and each app's sets waiting for you. */
export function groupSets(sets: ActionSetView[]): Map<string, { active?: ActionSetView; proposed: ActionSetView[] }> {
  const out = new Map<string, { active?: ActionSetView; proposed: ActionSetView[] }>();
  for (const s of sets) {
    const entry = out.get(s.app) ?? { proposed: [] };
    if (s.status === "approved" && (!entry.active || s.updated_at > entry.active.updated_at)) entry.active = s;
    if (s.status === "proposed") entry.proposed.push(s);
    out.set(s.app, entry);
  }
  return out;
}

/** Your setting for one action, "" when you set none. */
export function modeOf(modes: ActionModeView[] | undefined, app: string, action: string): ActionMode {
  return (modes?.find((m) => m.app === app && m.action === action)?.mode ?? "") as ActionMode;
}
