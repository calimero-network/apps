import type { ReactNode } from "react";
import { bindApi, peekApi, useApi } from "./client";

/**
 * Mount once under `MeroProvider`, above every page. Binds during render so a
 * child's effect — which runs before this component's own would — already
 * finds the clients. See `client.ts`.
 */
export function ApiBinder({ children }: { children: ReactNode }) {
  const binding = useApi();
  if (peekApi() !== binding) bindApi(binding);
  return <>{children}</>;
}
