import { clearAllStorage } from "@calimero-network/mero-react";

// rc.8 auth helper. mero-react owns the real auth state (see useMero() in
// App.tsx route guards); this thin hook just exposes a logout for components
// that aren't inside a route (e.g. ErrorModal). clearAllStorage wipes tokens,
// node url, and the active context/identity.
export const useAuth = () => {
  const logout = () => {
    clearAllStorage();
  };
  return { logout };
};
