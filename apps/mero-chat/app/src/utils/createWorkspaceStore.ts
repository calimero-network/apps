import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  open = next;
  listeners.forEach((l) => l());
}

/** Opens the create-workspace dialog (`ChatWorkspaceCreator`, mounted once in `App`). */
export const openCreateWorkspace = () => set(true);
export const closeCreateWorkspace = () => set(false);

export function useCreateWorkspaceOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => open,
    () => false,
  );
}
