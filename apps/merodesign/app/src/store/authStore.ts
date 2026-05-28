import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  nodeUrl: string;
  accessToken: string;
  refreshToken: string;
  setAuth: (nodeUrl: string, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      nodeUrl: "",
      accessToken: "",
      refreshToken: "",
      setAuth: (nodeUrl, accessToken, refreshToken) =>
        set({ nodeUrl, accessToken, refreshToken }),
      clearAuth: () => set({ nodeUrl: "", accessToken: "", refreshToken: "" }),
      isAuthenticated: () => Boolean(get().accessToken && get().nodeUrl),
    }),
    { name: "merodesign-auth" },
  ),
);
