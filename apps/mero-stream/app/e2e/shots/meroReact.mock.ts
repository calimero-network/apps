// Aliased over @calimero-network/mero-react by vite.config.ts. The pages need a
// session-shaped object to render; nothing here reaches a node.
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
      },
      ephemeral: { set: async () => {}, subscribe: () => () => {} },
    },
    applicationId: "3xKm9QpLvR7nTzB4aW1cYeUf3gJd6NqSvXhKrM8tZoPq",
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
