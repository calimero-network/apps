// Aliased over ../../src/lib/nickname. The label helpers are the REAL ones —
// they are the thing the byline screenshots are about — only the hook that
// would reach a node is replaced.
import { scenarioById } from "./fixtures";

// The explicit `.ts` matters: the alias in vite.config.ts matches
// `.../lib/nickname` with no extension, so a bare re-export here would resolve
// back to THIS file and rollup rejects it as "a reexport that references
// itself". With the extension the alias does not match and the real module is
// loaded — which is the point, since these helpers are what the byline
// screenshots are testing.
export { authorLabel, shortAccount } from "../../src/lib/nickname.ts";
export type { AuthorLabel, Nickname } from "../../src/lib/nickname.ts";

const sc = () =>
  scenarioById(new URLSearchParams(location.search).get("s") ?? "feed");

export function useNickname() {
  return {
    name: sc().unnamed ? "" : "Ana",
    saving: false,
    error: null,
    rename: async () => {},
  };
}
