import type { ReactNode } from "react";

export const AppMode = { MultiContext: "MultiContext" } as const;
export function MeroProvider({ children }: { children: ReactNode }) {
  return children as never;
}
export function useMero() {
  return { mero: null, isAuthenticated: true, isLoading: false };
}
export function ConnectButton() {
  return null;
}
