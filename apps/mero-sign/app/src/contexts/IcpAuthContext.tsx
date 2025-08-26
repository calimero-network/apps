import React, { createContext, useContext, useState, useEffect } from 'react';
import { AuthClient } from '@dfinity/auth-client';
import type { Identity } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';

export interface AuthState {
  isAuthenticated: boolean;
  identity: Identity | null;
  principal: Principal | null;
}

class AuthService {
  private authClient: AuthClient | null = null;
  private listeners: ((authState: AuthState) => void)[] = [];
  private isInitialized = false;
  private currentIdentity: Identity | null = null;

  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    this.authClient = await AuthClient.create();

    try {
      const authenticated = await this.authClient.isAuthenticated();
      if (authenticated) {
        this.currentIdentity = this.authClient.getIdentity();
      } else {
        this.currentIdentity = null;
      }
    } catch (e) {
      console.warn('AuthService.init: failed to check authentication state', e);
      this.currentIdentity = null;
    }

    this.isInitialized = true;
    this.notifyListeners();
  }

  async login(): Promise<void> {
    if (!this.authClient) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      this.authClient!.login({
        identityProvider:
          import.meta.env.VITE_DFX_NETWORK === 'local'
            ? `http://${import.meta.env.VITE_INTERNET_IDENTITY_CANISTER_ID}.localhost:4943`
            : 'https://identity.ic0.app',

        windowOpenerFeatures: `
          left=${window.screen.width / 2 - 250},
          top=${window.screen.height / 2 - 400},
          width=500,
          height=800
        `,

        onSuccess: async () => {
          try {
            this.currentIdentity = this.authClient!.getIdentity();
          } catch (e) {
            console.warn(
              'AuthService.login: failed to read identity after login',
              e,
            );
            this.currentIdentity = null;
          }
          this.notifyListeners();
          resolve();
        },
        onError: (error) => {
          console.error('Login failed:', error);
          reject(error);
        },
      });
    });
  }

  async logout(): Promise<void> {
    if (!this.authClient) {
      return;
    }
    await this.authClient.logout();
    this.currentIdentity = null;
    this.notifyListeners();
  }

  getAuthState(): AuthState {
    const identity = this.currentIdentity;
    const isAuthenticated =
      !!identity && !identity.getPrincipal().isAnonymous();
    return {
      isAuthenticated,
      identity: isAuthenticated ? identity : null,
      principal: isAuthenticated ? identity!.getPrincipal() : null,
    };
  }

  subscribe(listener: (authState: AuthState) => void): () => void {
    this.listeners.push(listener);
    listener(this.getAuthState());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    const authState = this.getAuthState();
    this.listeners.forEach((listener) => listener(authState));
  }
}

export const authService = new AuthService();

// --- React Context and Provider ---

interface IcpAuthContextType {
  isAuthenticated: boolean;
  identity: Identity | null;
  principal: Principal | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const IcpAuthContext = createContext<IcpAuthContextType | undefined>(undefined);

export const useIcpAuth = () => {
  const ctx = useContext(IcpAuthContext);
  if (!ctx) {
    throw new Error('useIcpAuth must be used within an IcpAuthProvider');
  }
  return ctx;
};

export const IcpAuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    identity: null,
    principal: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeAuth = async () => {
      await authService.init();
      const unsubscribe = authService.subscribe(setAuthState);
      setIsLoading(false);
      return unsubscribe;
    };

    initializeAuth();
  }, []);

  const value = {
    ...authState,
    login: () => authService.login(),
    logout: () => authService.logout(),
    isLoading,
  };

  return (
    <IcpAuthContext.Provider value={value}>{children}</IcpAuthContext.Provider>
  );
};
