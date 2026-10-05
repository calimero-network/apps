// mero-react, stubbed for the harness.
//
// The modal itself calls two things (`getContextIdentity`, `useMero` for the
// session kind). The rest is here because the bundler follows the import graph
// — the validation schema reaches the api layer, which imports node accessors
// — and a module that only needs to EXIST must still export the right names or
// rollup fails the build. Every stub is inert: nothing in a screenshot may
// reach a node.
export function getContextIdentity(): string {
  return "a1".repeat(32);
}
export function getContextId(): string {
  return "c0".repeat(32);
}
export function getApplicationId(): string {
  return "d0".repeat(32);
}
export function getNodeUrl(): string {
  return "http://127.0.0.1:2528";
}
export function setContextId(): void {}
export function setContextIdentity(): void {}
export function setApplicationId(): void {}
export function clearAllStorage(): void {}
export function useMero() {
  return {
    isAuthenticated: true,
    isLoading: false,
    nodeUrl: "http://127.0.0.1:2528",
    applicationId: "d0".repeat(32),
    mero: null,
    admin: null,
    isDelegated: false,
    connectToNode: () => {},
    logout: () => {},
  };
}
export const MeroProvider = ({ children }: { children?: unknown }) => children;
export const AppMode = { MultiContext: "multi-context" } as const;
