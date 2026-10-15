import type { Actor } from "./lifecycle";

/**
 * A person names themselves once per team (namespace member metadata), and
 * every space in it — board, project, workbook, calendar — joins them under
 * that name. A driver that answered every name prompt it met would pass with
 * the app asking on every space, which is the regression this exists to catch.
 *
 * Call it each time a driver answers a name prompt. The first prompt per actor
 * per run is expected (nobody has a name yet); any later one fails the run.
 */
const asked = new Map<string, string>();

export function answeredNamePrompt(actor: Actor, where: string): void {
  const key = `${actor.run}:${actor.name}`;
  const first = asked.get(key);
  if (first !== undefined) {
    throw new Error(
      `${actor.name} was asked for a name again on ${where}, after naming themselves on ${first}: ` +
        "a name is per team and must not be asked for per space",
    );
  }
  asked.set(key, where);
}
