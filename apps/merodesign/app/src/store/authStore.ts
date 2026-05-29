import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  nodeUrl: string;
  accessToken: string;
  refreshToken: string;
  applicationId: string;
  setAuth: (nodeUrl: string, accessToken: string, refreshToken: string, applicationId: string) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      nodeUrl: "",
      accessToken: "",
      refreshToken: "",
      applicationId: "",
      setAuth: (nodeUrl, accessToken, refreshToken, applicationId) =>
        set({ nodeUrl, accessToken, refreshToken, applicationId }),
      clearAuth: () => set({ nodeUrl: "", accessToken: "", refreshToken: "", applicationId: "" }),
      isAuthenticated: () => Boolean(get().accessToken && get().nodeUrl),
    }),
    { name: "merodesign-auth", version: 0 },
  ),
);
