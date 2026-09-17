// Aliased over @calimero-network/mero-react by vite.config.ts. The pages need a
// session-shaped object to render; nothing here reaches a node.
import { APP_PACKAGE } from "../../src/lib/appId";
import { scenarioById } from "./fixtures";

const APP_ID = "3xKm9QpLvR7nTzB4aW1cYeUf3gJd6NqSvXhKrM8tZoPq";

const sc = () =>
  scenarioById(new URLSearchParams(location.search).get("s") ?? "teams");

export function useMero() {
  return {
    mero: {
      admin: {
        getNamespace: async () => ({ name: "Engineering" }),
        getContexts: async () => ({ contexts: [] }),
        listNamespacesForApplication: async () => [],
        listNamespaceGroups: async () => [],
        /**
         * `useApplicationId` asks the NODE which installed app is this one and
         * matches on the package (src/lib/appId). The second, wrong-package
         * install is the point: it proves the filter in the shot, where a
         * one-app list would pass even if the matching were dropped.
         */
        listApplications: async () => ({
          apps: sc().notInstalled
            ? [
                {
                  id: "someone-elses",
                  package: "com.calimero.mero-design",
                  version: "1.4.0",
                },
              ]
            : [
                {
                  id: "someone-elses",
                  package: "com.calimero.mero-design",
                  version: "1.4.0",
                },
                { id: APP_ID, package: APP_PACKAGE, version: "1.2.0" },
              ],
        }),
      },
      rpc: {
        // RoomsPage enriches each joined room with its lobby roster.
        execute: async () => ({
          members: [
            { memberId: "a".repeat(64), username: "Ana" },
            { memberId: "b".repeat(64), username: "Marek" },
            {
              memberId: "8Qk2Hs9vLxTnR4mZbA1cWpYeUf3gJd6NqSvXhKrM8tBz",
              username: "You",
            },
          ],
        }),
      },
    },
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
