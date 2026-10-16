// Aliased over @calimero-network/mero-react by vite.config.ts. The pages need a
// session-shaped object to render; nothing here reaches a node.
import { scenarioById } from "./fixtures";

// The invitation dialog is the real one; only the redemption driving it is a
// fixture, so the "invitation" shot shows the production prompt.
// The invitation screen is real too; with no MeroProvider here it shows nothing.
export { InvitationDialog, InvitationGate, JoinSyncBanner } from "mero-react-real";

/** The id `pickApplicationId` should settle on for the fixture node. */
const APP_ID = "3xKm9QpLvR7nTzB4aW1cYeUf3gJd6NqSvXhKrM8tZoPq";

export function useMero() {
  return {
    mero: {
      // Only what the pages actually reach for. `getNamespace` is called
      // DIRECTLY rather than through lib/groups, so aliasing groups alone left it
      // undefined and the rooms page caught its own TypeError as "could not load
      // rooms" — a blank list rather than a crash, which is why the harness's
      // landmark wait caught it and a pageerror check would not have.
      admin: {
        getNamespace: async () => ({ name: "Engineering standup" }),
        getContexts: async () => ({ contexts: [] }),
        listNamespacesForApplication: async () => [],
        listNamespaceGroups: async () => [],
        // `useApplicationId` asks the NODE which installed app is this one and
        // matches on the package — see src/lib/appId. Without this the resolve
        // fails closed to "", every page renders its "not installed" empty
        // state, and the harness photographs that instead of the app. Carrying
        // a second, wrong-package install here is the point: it proves the
        // filter in the shot, rather than a one-app list that would pass even
        // if the matching were dropped.
        listApplications: async () => ({
          apps: [
            {
              id: "designs-own-id",
              package: "com.calimero.mero-design",
              version: "1.4.0",
            },
            {
              id: APP_ID,
              package: "com.calimero.mero-forum",
              version: "1.2.0",
            },
          ],
        }),
      },
      ephemeral: { set: async () => {}, subscribe: () => () => {} },
    },
    // SessionMenu shows the node it is talking to and offers a way out. Both
    // come off `useMero()`, so both have to exist here or the menu throws.
    nodeUrl: "http://localhost:2528",
    logout: () => {},
    applicationId: APP_ID,
    isAuthenticated: true,
    isLoading: false,
  };
}

export function useExecute() {
  return { execute: async () => null, loading: false, error: null };
}

export function useSubscription() {
  return undefined;
}

/** `useSelfAccount` reads this; the byline's "(you)" depends on it. */
export function useNodeIdentity() {
  return { identity: { accountId: "a".repeat(64) }, loading: false };
}

export function useJoinSync() {
  return { isSyncing: false, dismiss: () => {} };
}

/** Only the "invitation" scenario has a link open, waiting on a click. */
export function useInviteRedemption() {
  const id = new URLSearchParams(location.search).get("s") ?? "feed";
  const asking = scenarioById(id).id === "invitation";
  const noop = () => {};
  return {
    state: asking
      ? { stage: "awaiting-confirmation", teamName: "Design review" }
      : { stage: "idle" },
    token: asking ? "shots-token" : null,
    parsed: null,
    accept: noop,
    decline: noop,
    retry: noop,
    dismiss: noop,
  };
}
