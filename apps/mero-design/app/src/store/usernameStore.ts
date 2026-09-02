import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UsernameState {
  // keyed by identity so multiple accounts on the same device work
  usernames: Record<string, string>;
  setUsername: (identity: string, username: string) => void;
  getUsername: (identity: string) => string | undefined;
}

export const useUsernameStore = create<UsernameState>()(
  persist(
    (set, get) => ({
      usernames: {},
      setUsername: (identity, username) =>
        set((s) => ({ usernames: { ...s.usernames, [identity]: username } })),
      getUsername: (identity) => get().usernames[identity],
    }),
    // ⚠️ Keeps the pre-rename spelling on purpose: this is a localStorage key,
    // and renaming it would silently discard every username already saved.
    { name: "merodesign-usernames", version: 0 },
  ),
);
