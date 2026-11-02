/**
 * v1's mero-react accessors for "the open context" and "my identity in it",
 * under the names the screens import. A context is an app instance; the
 * identity is the signed-in account (1.0 has no per-context keys).
 */
import { getActiveApp, selfAccount, setActiveApp } from "./connection";

export function getContextId(): string {
  return getActiveApp();
}

export function setContextId(app: string): void {
  setActiveApp(app);
}

export function getContextIdentity(): string {
  return selfAccount();
}
