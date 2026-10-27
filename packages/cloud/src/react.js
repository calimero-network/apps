// The app-facing React layer (v1's @calimero-network/mero-react 10.3.0, MIT),
// on release-v2. Its hooks and invitation handling are carried over as they
// were, so every app keeps its behaviour; what changed is underneath them:
// `admin`, `rpc`, `events` and `ephemeral` come from ./backend.ts, and the
// provider and sign-in UI (from react-auth.part.js) use passkeys on the cluster
// instead of a node's auth redirect or a wallet.
/* eslint-disable */
// @ts-nocheck
import { createContext, useMemo, useState, useRef, useCallback, useEffect, useContext, useReducer, useId, useSyncExternalStore } from 'react';
import { AuthRevokedError, CloudClient, CloudMero, DEFAULT_LOCAL_NODE_PORTS, HTTPError, LocalStorageTokenStore, MeroJs, NotOnCloudError, bootstrapFromInvitation, buildAuthLoginUrl, buildDelegatedClient, carryExecutorAccount, classifyError, clearDelegatedCredential, clearDelegatedSession, compareSemver, completeDeviceEnrolment, createAccountAdmin, createCloudAdmin, createDelegatedContext, createDelegatedPrivateContext, createNodeAdmin, currentApplicationId, defaultClusterUrl, deviceEnrolmentUrl, discoverLocalNodes, ensureBundle, ensurePackage, foundDelegatedNamespace, governRoot, joinAsAccount, learnRelayNodeKey, listDelegatedContexts, listDelegatedNamespaces, memberJoinedOpenOp, nodeEndpoint, parseAuthCallback, readDelegatedCredential, readDelegatedSession, readEnrolmentCallback, readPinnedRelayNodeKey, redeemInvitation, relayForContext, rememberRelay, resolveApplicationIdFromRegistry, saveDelegatedCredential, saveDelegatedSession, setCurrentApplicationId, setCurrentContextId, shouldRetain, signerFromSecret, writeSession } from './backend.ts';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { createPortal } from 'react-dom';

// #style-inject:#style-inject
function styleInject(css, { insertAt } = {}) {
  if (typeof document === "undefined") return;
  const head = document.head || document.getElementsByTagName("head")[0];
  const style = document.createElement("style");
  style.type = "text/css";
  if (insertAt === "top") {
    if (head.firstChild) {
      head.insertBefore(style, head.firstChild);
    } else {
      head.appendChild(style);
    }
  } else {
    head.appendChild(style);
  }
  if (style.styleSheet) {
    style.styleSheet.cssText = css;
  } else {
    style.appendChild(document.createTextNode(css));
  }
}

// src/components/styles.css
styleInject(':root {\n  --mero-bg: #0d1117;\n  --mero-bg-secondary: #161b22;\n  --mero-bg-tertiary: #1c2128;\n  --mero-text: #e6edf3;\n  --mero-text-secondary: #8b949e;\n  --mero-accent: #a5ff11;\n  --mero-accent-hover: #8ed40d;\n  --mero-on-primary: #0d1117;\n  --mero-error: #ff6b6b;\n  --mero-border: #30363d;\n  --mero-disabled: #555555;\n  --mero-shadow: rgba(0, 0, 0, 0.5);\n  --mero-overlay: rgba(0, 0, 0, 0.75);\n  --mero-radius: 8px;\n}\n.mero-connect-button {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  padding: 10px 20px;\n  background-color: var(--mero-accent);\n  border: 1px solid var(--mero-accent);\n  border-radius: var(--mero-radius);\n  cursor: pointer;\n  font-size: 14px;\n  font-weight: 600;\n  letter-spacing: 0.01em;\n  color: var(--mero-on-primary);\n  transition:\n    background-color 0.15s ease,\n    border-color 0.15s ease,\n    box-shadow 0.15s ease,\n    transform 0.1s ease;\n  min-width: 140px;\n  box-sizing: border-box;\n  font-family:\n    "Inter",\n    -apple-system,\n    BlinkMacSystemFont,\n    "Segoe UI",\n    Roboto,\n    Oxygen,\n    Ubuntu,\n    sans-serif;\n  -webkit-font-smoothing: antialiased;\n  -moz-osx-font-smoothing: grayscale;\n  line-height: 1;\n}\n.mero-connect-button:hover:not(.mero-connected):not(.mero-reconnecting) {\n  background-color: var(--mero-accent-hover);\n  border-color: var(--mero-accent-hover);\n  box-shadow: 0 0 0 4px rgba(165, 255, 17, 0.18);\n  box-shadow: 0 0 0 4px color-mix(in srgb, var(--mero-accent) 18%, transparent);\n}\n.mero-connect-button:active:not(.mero-connected):not(.mero-reconnecting) {\n  transform: translateY(1px);\n}\n.mero-connect-button:focus-visible {\n  outline: none;\n  box-shadow: 0 0 0 3px rgba(165, 255, 17, 0.45);\n  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mero-accent) 45%, transparent);\n}\n.mero-connect-button.mero-logo-only {\n  min-width: 0;\n  width: 40px;\n  height: 40px;\n  padding: 0;\n  gap: 0;\n}\n.mero-connect-button.mero-connected {\n  background-color: var(--mero-accent);\n  color: var(--mero-on-primary);\n  border-color: var(--mero-accent);\n}\n.mero-connect-button.mero-connected:hover {\n  background-color: var(--mero-accent-hover);\n  border-color: var(--mero-accent-hover);\n}\n.mero-connect-button.mero-reconnecting {\n  background-color: var(--mero-bg-secondary);\n  color: var(--mero-text-secondary);\n  border-color: var(--mero-border);\n  cursor: not-allowed;\n}\n.mero-connect-container {\n  position: relative;\n  display: inline-block;\n}\n.mero-dropdown {\n  position: absolute;\n  top: 100%;\n  left: 0;\n  background-color: var(--mero-bg-secondary);\n  border: 1px solid var(--mero-border);\n  border-radius: var(--mero-radius);\n  margin-top: 6px;\n  padding: 0;\n  z-index: 1001;\n  width: 100%;\n  min-width: 180px;\n  overflow: hidden;\n  box-shadow: 0 8px 24px var(--mero-shadow);\n}\n.mero-dropdown-info {\n  padding: 10px 16px;\n  color: var(--mero-text-secondary);\n  font-size: 13px;\n  border-bottom: 1px solid var(--mero-border);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  max-width: 220px;\n}\n.mero-dropdown-item {\n  display: block;\n  width: 100%;\n  padding: 10px 16px;\n  background: none;\n  border: none;\n  color: var(--mero-text);\n  text-align: left;\n  cursor: pointer;\n  font-size: 14px;\n  text-decoration: none;\n  font-family: inherit;\n}\n.mero-dropdown-item:hover {\n  background-color: var(--mero-accent);\n  color: var(--mero-on-primary);\n}\n.mero-logo {\n  width: 24px;\n  height: 24px;\n  color: currentColor;\n}\n@keyframes meroFadeIn {\n  from {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}\n@keyframes meroSlideIn {\n  from {\n    transform: translateY(-12px);\n    opacity: 0;\n  }\n  to {\n    transform: translateY(0);\n    opacity: 1;\n  }\n}\n@keyframes meroSpin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n.mero-invite-overlay {\n  position: fixed;\n  inset: 0;\n  z-index: 2147483646;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 16px;\n  background: var(--mero-overlay);\n  font-family:\n    "Inter",\n    -apple-system,\n    BlinkMacSystemFont,\n    "Segoe UI",\n    Roboto,\n    Oxygen,\n    Ubuntu,\n    sans-serif;\n  -webkit-font-smoothing: antialiased;\n}\n.mero-invite-dialog {\n  box-sizing: border-box;\n  width: min(420px, 100%);\n  padding: 24px;\n  border: 1px solid var(--mero-border);\n  border-radius: calc(var(--mero-radius) * 1.5);\n  background: var(--mero-bg-secondary);\n  color: var(--mero-text);\n  box-shadow: 0 16px 48px var(--mero-shadow);\n  outline: none;\n  animation: mero-invite-in 0.16s ease-out;\n}\n.mero-invite-app {\n  margin: 0 0 12px;\n  font-size: 12px;\n  font-weight: 600;\n  letter-spacing: 0.06em;\n  text-transform: uppercase;\n  color: var(--mero-text-secondary);\n}\n.mero-invite-head {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n}\n.mero-invite-title {\n  margin: 0;\n  min-width: 0;\n  font-size: 18px;\n  font-weight: 600;\n  line-height: 1.3;\n  overflow-wrap: anywhere;\n}\n.mero-invite-body {\n  margin: 12px 0 0;\n  font-size: 14px;\n  line-height: 1.5;\n  color: var(--mero-text-secondary);\n}\n.mero-invite-body-error {\n  color: var(--mero-error);\n}\n.mero-invite-icon {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 36px;\n  height: 36px;\n  border-radius: 50%;\n  background: var(--mero-bg-tertiary);\n  color: var(--mero-accent);\n}\n.mero-invite-icon-error {\n  color: var(--mero-error);\n}\n.mero-invite-spinner {\n  box-sizing: border-box;\n  width: 36px;\n  height: 36px;\n  border: 3px solid var(--mero-bg-tertiary);\n  border-top-color: var(--mero-accent);\n  background: none;\n  animation: mero-invite-spin 0.8s linear infinite;\n}\n.mero-invite-progress {\n  position: relative;\n  height: 3px;\n  margin-top: 16px;\n  overflow: hidden;\n  border-radius: 2px;\n  background: var(--mero-bg-tertiary);\n}\n.mero-invite-progress-bar {\n  position: absolute;\n  top: 0;\n  bottom: 0;\n  width: 40%;\n  border-radius: 2px;\n  background: var(--mero-accent);\n  animation: mero-invite-progress 1.4s ease-in-out infinite;\n}\n.mero-invite-actions {\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: flex-end;\n  gap: 8px;\n  margin-top: 20px;\n}\n.mero-invite-actions:empty {\n  display: none;\n}\n.mero-invite-button {\n  padding: 9px 16px;\n  border-radius: var(--mero-radius);\n  font: inherit;\n  font-size: 14px;\n  font-weight: 600;\n  line-height: 1.2;\n  cursor: pointer;\n  transition: background-color 0.15s ease, border-color 0.15s ease;\n}\n.mero-invite-button:focus-visible {\n  outline: 2px solid var(--mero-accent);\n  outline-offset: 2px;\n}\n.mero-invite-primary {\n  border: 1px solid var(--mero-accent);\n  background: var(--mero-accent);\n  color: var(--mero-on-primary);\n}\n.mero-invite-primary:hover {\n  border-color: var(--mero-accent-hover);\n  background: var(--mero-accent-hover);\n}\n.mero-invite-secondary {\n  border: 1px solid var(--mero-border);\n  background: transparent;\n  color: var(--mero-text);\n}\n.mero-invite-secondary:hover {\n  background: var(--mero-bg-tertiary);\n}\n.mero-invite-landing {\n  position: fixed;\n  inset: 0;\n  z-index: 9999;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 16px;\n  overflow-y: auto;\n  background: var(--mero-bg);\n  color: var(--mero-text);\n  font-family:\n    "Inter",\n    -apple-system,\n    BlinkMacSystemFont,\n    "Segoe UI",\n    Roboto,\n    Oxygen,\n    Ubuntu,\n    sans-serif;\n  -webkit-font-smoothing: antialiased;\n}\n.mero-invite-landing-card {\n  width: min(460px, 100%);\n}\n.mero-invite-landing-card .mero-invite-title {\n  font-size: 22px;\n}\n.mero-invite-landing-login {\n  display: inline-flex;\n}\n.mero-invite-landing-login .mero-connect-button {\n  min-width: 0;\n  padding: 9px 16px;\n  line-height: 1.2;\n}\n@keyframes mero-invite-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n@keyframes mero-invite-progress {\n  from {\n    left: -40%;\n  }\n  to {\n    left: 100%;\n  }\n}\n@keyframes mero-invite-in {\n  from {\n    opacity: 0;\n    transform: translateY(6px) scale(0.98);\n  }\n}\n@media (prefers-reduced-motion: reduce) {\n  .mero-invite-dialog,\n  .mero-invite-spinner,\n  .mero-invite-progress-bar {\n    animation: none;\n  }\n}\n');

// src/types.ts
var AppMode = /* @__PURE__ */ ((AppMode2) => {
  AppMode2["SingleContext"] = "single-context";
  AppMode2["MultiContext"] = "multi-context";
  AppMode2["Admin"] = "admin";
  return AppMode2;
})(AppMode || {});
var ConnectionType = /* @__PURE__ */ ((ConnectionType2) => {
  ConnectionType2["RemoteAndLocal"] = "remote-and-local";
  ConnectionType2["Remote"] = "remote";
  ConnectionType2["Local"] = "local";
  ConnectionType2["Custom"] = "custom";
  return ConnectionType2;
})(ConnectionType || {});

// src/auth/node-trust.ts
function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
function resolveTrustedNodeUrl(params) {
  const { candidate, initiated, allowedNodeUrls } = params;
  if (!candidate) {
    return { url: initiated ?? null, rejected: false };
  }
  if (initiated) {
    return sameOrigin(candidate, initiated) ? { url: candidate, rejected: false } : { url: null, rejected: true };
  }
  if (allowedNodeUrls && allowedNodeUrls.length > 0) {
    return allowedNodeUrls.some((u) => sameOrigin(candidate, u)) ? { url: candidate, rejected: false } : { url: null, rejected: true };
  }
  return { url: null, rejected: true };
}

// src/auth/token-adoption.ts
var HOUR_MS = 36e5;
function decodeJwtClaims(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const payload = JSON.parse(atob(b64));
    if (!payload || typeof payload !== "object") return null;
    const { iat, exp } = payload;
    return {
      iat: typeof iat === "number" && iat > 0 ? iat : void 0,
      exp: typeof exp === "number" && exp > 0 ? exp : void 0
    };
  } catch {
    return null;
  }
}
function expiresAtFromJwt(token, fallbackMs = Date.now() + HOUR_MS) {
  const exp = decodeJwtClaims(token)?.exp;
  return exp ? exp * 1e3 : fallbackMs;
}
function isCallbackNewer(callbackAccessToken, stored) {
  const incoming = decodeJwtClaims(callbackAccessToken);
  if (!incoming) return false;
  const current2 = decodeJwtClaims(stored.access_token);
  if (current2) {
    if (incoming.iat !== void 0 && current2.iat !== void 0 && incoming.iat !== current2.iat) {
      return incoming.iat > current2.iat;
    }
    if (incoming.exp !== void 0 && current2.exp !== void 0 && incoming.exp !== current2.exp) {
      return incoming.exp > current2.exp;
    }
    return false;
  }
  return incoming.exp !== void 0 && incoming.exp * 1e3 > stored.expires_at;
}
function resolveTokenAdoption(params) {
  const { callbackAccessToken, callbackRefreshToken, callbackNodeUrl, stored, storedNodeUrl } = params;
  const bundle = (refreshToken2) => ({
    access_token: callbackAccessToken,
    refresh_token: refreshToken2,
    expires_at: expiresAtFromJwt(callbackAccessToken)
  });
  if (!stored?.access_token) {
    return { adopt: true, tokens: bundle(callbackRefreshToken), reason: "fresh-login" };
  }
  const sameNode = !!storedNodeUrl && sameOrigin(callbackNodeUrl, storedNodeUrl);
  if (!sameNode) {
    return { adopt: true, tokens: bundle(callbackRefreshToken), reason: "node-changed" };
  }
  const refreshToken = callbackRefreshToken || stored.refresh_token;
  if (isCallbackNewer(callbackAccessToken, stored)) {
    return { adopt: true, tokens: bundle(refreshToken), reason: "newer" };
  }
  if (!stored.refresh_token && callbackRefreshToken) {
    return {
      adopt: true,
      tokens: { ...stored, refresh_token: callbackRefreshToken },
      reason: "fill-refresh"
    };
  }
  return { adopt: false, reason: "stale" };
}

// src/utils/desktop.ts
function isDesktopWindow() {
  if (typeof window === "undefined") return false;
  const w = window;
  const internals = w.__TAURI_INTERNALS__;
  const tauri = typeof internals === "object" && internals !== null && !(typeof Node !== "undefined" && internals instanceof Node) && typeof internals.invoke === "function";
  return tauri || w.__TAURI_FETCH_PROXY_INJECTED__ === true;
}

// src/storage/index.ts
var STORAGE_KEYS = {
  ACCESS_TOKEN: "mero:access_token",
  REFRESH_TOKEN: "mero:refresh_token",
  EXPIRES_AT: "mero:expires_at",
  NODE_URL: "mero:node_url",
  // The node the token bundle currently in the TokenStore was issued by. Distinct
  // from NODE_URL, which `connectToNode` overwrites with the *target* node before
  // redirecting to login — so at callback time NODE_URL names where we are going,
  // not who minted the tokens we still hold. Telling those apart is what lets the
  // SSO callback re-seed on a node change without mistaking a different node's
  // bundle for a rotated one (see auth/token-adoption.ts).
  TOKEN_NODE_URL: "mero:token_node_url",
  APPLICATION_ID: "mero:application_id",
  CONTEXT_ID: "mero:context_id",
  CONTEXT_IDENTITY: "mero:context_identity"
};
var _storageAvailable = null;
function isLocalStorageAvailable() {
  if (_storageAvailable !== null) return _storageAvailable;
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      _storageAvailable = false;
      return false;
    }
    const testKey = "__mero_test__";
    localStorage.setItem(testKey, "test");
    localStorage.removeItem(testKey);
    _storageAvailable = true;
  } catch {
    _storageAvailable = false;
  }
  return _storageAvailable;
}
var localStorageTokenStorage = {
  async get() {
    if (!isLocalStorageAvailable()) {
      return null;
    }
    try {
      const accessToken = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      const expiresAt = localStorage.getItem(STORAGE_KEYS.EXPIRES_AT);
      if (!accessToken || !refreshToken) {
        return null;
      }
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt ? parseInt(expiresAt, 10) : Date.now() + 36e5
      };
    } catch (e) {
      console.error("[mero-react] Failed to get token from storage:", e);
      return null;
    }
  },
  async set(token) {
    if (!isLocalStorageAvailable()) {
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, token.access_token);
      localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, token.refresh_token);
      localStorage.setItem(STORAGE_KEYS.EXPIRES_AT, token.expires_at.toString());
    } catch (e) {
      console.error("[mero-react] Failed to save token to storage:", e);
    }
  },
  async clear() {
    if (!isLocalStorageAvailable()) {
      return;
    }
    try {
      localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.EXPIRES_AT);
    } catch (e) {
      console.error("[mero-react] Failed to clear token from storage:", e);
    }
  }
};
function getNodeUrl() {
  if (!isLocalStorageAvailable()) return null;
  return localStorage.getItem(STORAGE_KEYS.NODE_URL);
}
function setNodeUrl(url) {
  if (!isLocalStorageAvailable()) return;
  localStorage.setItem(STORAGE_KEYS.NODE_URL, url);
}
function clearNodeUrl() {
  if (!isLocalStorageAvailable()) return;
  localStorage.removeItem(STORAGE_KEYS.NODE_URL);
}
function getTokenNodeUrl() {
  if (!isLocalStorageAvailable()) return null;
  return localStorage.getItem(STORAGE_KEYS.TOKEN_NODE_URL);
}
function setTokenNodeUrl(url) {
  if (!isLocalStorageAvailable()) return;
  localStorage.setItem(STORAGE_KEYS.TOKEN_NODE_URL, url);
}
function clearTokenNodeUrl() {
  if (!isLocalStorageAvailable()) return;
  localStorage.removeItem(STORAGE_KEYS.TOKEN_NODE_URL);
}
function getApplicationId() {
  if (!isLocalStorageAvailable()) return null;
  return localStorage.getItem(STORAGE_KEYS.APPLICATION_ID);
}
function setApplicationId(id) {
  setCurrentApplicationId(id);
  if (!isLocalStorageAvailable()) return;
  localStorage.setItem(STORAGE_KEYS.APPLICATION_ID, id);
}
function clearApplicationId() {
  if (!isLocalStorageAvailable()) return;
  localStorage.removeItem(STORAGE_KEYS.APPLICATION_ID);
}
function getContextId() {
  if (!isLocalStorageAvailable()) return null;
  return localStorage.getItem(STORAGE_KEYS.CONTEXT_ID);
}
function setContextId(id) {
  setCurrentContextId(id);
  if (!isLocalStorageAvailable()) return;
  localStorage.setItem(STORAGE_KEYS.CONTEXT_ID, id);
}
function clearContextId() {
  if (!isLocalStorageAvailable()) return;
  localStorage.removeItem(STORAGE_KEYS.CONTEXT_ID);
}
function getContextIdentity() {
  if (!isLocalStorageAvailable()) return null;
  return localStorage.getItem(STORAGE_KEYS.CONTEXT_IDENTITY);
}
function setContextIdentity(id) {
  if (!isLocalStorageAvailable()) return;
  localStorage.setItem(STORAGE_KEYS.CONTEXT_IDENTITY, id);
}
function clearContextIdentity() {
  if (!isLocalStorageAvailable()) return;
  localStorage.removeItem(STORAGE_KEYS.CONTEXT_IDENTITY);
}
function clearAllStorage() {
  if (!isLocalStorageAvailable()) return;
  Object.values(STORAGE_KEYS).forEach((key) => {
    localStorage.removeItem(key);
  });
}
var MeroContext = createContext(null);
var DEFAULT_REGISTRY_URL = "https://apps.calimero.network";
var isBrowser = typeof window !== "undefined";
var DESKTOP_HOST = isDesktopWindow();
var parsedCallback = null;
function readAuthCallback() {
  const href = window.location.href;
  if (parsedCallback?.href !== href) {
    parsedCallback = { href, result: parseAuthCallback(href, { allowUnsolicited: DESKTOP_HOST }) };
  }
  return parsedCallback.result;
}
function clearAuthCallbackFromUrl() {
  if (!new URLSearchParams(window.location.hash.slice(1)).has("access_token")) return;
  const url = new URL(window.location.href);
  url.searchParams.delete("auth_state");
  window.history.replaceState({}, "", url.pathname + url.search);
}
function getPermissionsForMode(mode) {
  switch (mode) {
    case "single-context" /* SingleContext */:
      return [
        "context:execute",
        "context:list",
        "context:subscribe",
        "application:list",
        "blob",
        "context:alias"
      ];
    case "multi-context" /* MultiContext */:
      return [
        "context:create",
        "context:delete",
        "context:list",
        "context:execute",
        "context:subscribe",
        "application:list",
        "namespace",
        "group",
        "blob",
        "context:alias"
      ];
    case "admin" /* Admin */:
      return ["admin"];
    default:
      throw new Error(`Unsupported application mode: ${mode}`);
  }
}
// ---------------------------------------------------------------------------
// release-v2: the provider and the sign-in UI.
//
// v1 signed a person in by sending the tab to a node's auth page and reading
// the tokens off the callback, or by enrolling a device with an account's
// wallet. On release-v2 a person IS a passkey account on the cluster: the
// dialog runs the passkey ceremony itself, in the page, and the session it
// gets is what every request carries. The props are v1's so no app changes.
// ---------------------------------------------------------------------------

function MeroProvider({
  children,
  mode,
  packageName,
  packageVersion,
  registryUrl,
  cloudBaseUrl,
  bundleUrl
}) {
  const [mero, setMero] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [nodeUrl, setNodeUrlState] = useState(() => getNodeUrl() || defaultClusterUrl());
  const [applicationId, setApplicationIdState] = useState(
    () => getApplicationId() || currentApplicationId() || null
  );
  const [contextId, setContextIdState] = useState(() => getContextId());
  const [contextIdentity, setContextIdentityState] = useState(() => getContextIdentity());
  const [loginOpen, setLoginOpen] = useState(false);
  const meroRef = useRef(null);
  const adopt = useCallback(async (url) => {
    meroRef.current?.close();
    const instance = new CloudMero(url);
    meroRef.current = instance;
    const ok = await instance.validate();
    if (meroRef.current !== instance) return false;
    if (ok) {
      setMero(instance);
      setIsAuthenticated(true);
      setIsOnline(true);
      const me = await instance.whoami().catch(() => null);
      if (me?.accountId) {
        setContextIdentity(me.accountId);
        setContextIdentityState(me.accountId);
      }
    }
    return ok;
  }, []);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await adopt(nodeUrl);
      } catch (err) {
        console.error("[calimero-cloud] could not restore the session:", err);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  // What this page creates its apps from: a signed package (installed from the
  // cluster's registry when the cluster lacks it), or, on a development
  // cluster, a raw bundle named at build time or the page's own wasm.
  useEffect(() => {
    if (!mero || !isAuthenticated) return;
    let active = true;
    const adoptId = (id) => {
      if (!active || !id) return;
      setApplicationId(id);
      setApplicationIdState(id);
    };
    const known = currentApplicationId();
    if (known) {
      adoptId(known);
      return;
    }
    if (packageName) {
      ensurePackage(mero, packageName, packageVersion, registryUrl ?? DEFAULT_REGISTRY_URL).then(adoptId, (err) =>
        console.warn(`[calimero-cloud] could not install ${packageName}${packageVersion ? `@${packageVersion}` : ""}`, err)
      );
      return () => {
        active = false;
      };
    }
    const base = (() => {
      try {
        return import.meta.env?.BASE_URL ?? "/";
      } catch {
        return "/";
      }
    })();
    const url = bundleUrl ?? `${base.replace(/\/?$/, "/")}app.wasm`;
    ensureBundle(mero, url).then(adoptId, (err) =>
      console.warn(`[calimero-cloud] this page names no package, and no development bundle at ${url}`, err)
    );
    return () => {
      active = false;
    };
  }, [mero, isAuthenticated, bundleUrl, packageName, packageVersion, registryUrl]);
  useEffect(() => {
    setCurrentContextId(contextId);
  }, [contextId]);
  useEffect(() => {
    if (!mero) return;
    const onError = (err) => {
      setIsOnline(false);
      if (err instanceof AuthRevokedError || err instanceof HTTPError && err.status === 401) {
        void mero.validate().then((ok) => {
          if (!ok) logout();
        });
      }
    };
    const onConnect = () => setIsOnline(true);
    mero.events.on("error", onError);
    mero.events.on("connect", onConnect);
    return () => {
      mero.events.off("error", onError);
      mero.events.off("connect", onConnect);
    };
  }, [mero]);
  /**
   * Sign in on `url`: adopt the session a sign-in dialog just got there, or
   * open the dialog. An app calling this from its own button keeps working.
   */
  const connectToNode = useCallback(
    (url) => {
      const target = url || defaultClusterUrl();
      setNodeUrl(target);
      setNodeUrlState(target);
      void adopt(target).then((ok) => {
        if (!ok) setLoginOpen(true);
      });
    },
    [adopt]
  );
  const connectWithAccount = useCallback(() => {
    console.warn("[calimero-cloud] connectWithAccount: accounts are passkeys on Calimero Cloud; opening sign-in");
    setLoginOpen(true);
  }, []);
  const logout = useCallback(() => {
    const instance = meroRef.current;
    meroRef.current = null;
    void instance?.signOut();
    instance?.close();
    writeSession(null);
    clearAllStorage();
    setMero(null);
    setIsAuthenticated(false);
    setApplicationIdState(currentApplicationId());
    setContextIdState(null);
    setContextIdentityState(null);
  }, []);
  const admin = useMemo(() => mero ? createCloudAdmin(mero) : null, [mero]);
  const contextValue = useMemo(
    () => ({
      mero,
      isAuthenticated,
      isOnline,
      nodeUrl,
      applicationId,
      contextId,
      contextIdentity,
      connectToNode,
      connectWithAccount,
      isDelegated: false,
      servedByNode: false,
      admin,
      can: { createNamespace: true, createContext: true, invite: true, upgrade: true },
      app: { packageName, packageVersion, registryUrl },
      cloudBaseUrl,
      logout,
      isLoading
    }),
    [mero, admin, isAuthenticated, isOnline, nodeUrl, applicationId, contextId, contextIdentity, connectToNode, connectWithAccount, logout, isLoading, packageName, packageVersion, registryUrl, cloudBaseUrl]
  );
  void mode;
  return /* @__PURE__ */ jsxs(MeroContext.Provider, { value: contextValue, children: [
    children,
    /* @__PURE__ */ jsx(
      LoginModal,
      {
        isOpen: loginOpen,
        onClose: () => setLoginOpen(false),
        onConnect: (url) => {
          setLoginOpen(false);
          setNodeUrl(url);
          setNodeUrlState(url);
          void adopt(url);
        }
      }
    )
  ] });
}
function useMero() {
  const context = useContext(MeroContext);
  if (!context) {
    throw new Error("useMero must be used within a MeroProvider");
  }
  return context;
}

/** v1's wallet enrolment; on release-v2 the dialog's passkey sign-in is the whole of it. */
function isReturningFromWallet() {
  return false;
}
function useAccountEnrolment(_options = {}) {
  return useMemo(
    () => ({
      goToWallet: async () => {
        throw new NotOnCloudError("goToWallet", "sign in with a passkey in the connect dialog");
      },
      note: null,
      returning: false,
      walletUrl: "",
      customWallet: false
    }),
    []
  );
}
function passkeyMessage(err) {
  if (err && typeof err === "object" && err.name === "NotAllowedError") {
    return "The passkey prompt was dismissed, or this device has no passkey for this cluster. Create an account if you have none.";
  }
  const status = err?.status;
  if (status === 0) return "Couldn't reach the cluster. Check the address and that it is running.";
  return err instanceof Error ? err.message : String(err);
}
function AccountSignInPanel({ onEnrol, note, theme }) {
  const t = resolveMeroTheme(theme);
  return /* @__PURE__ */ jsxs("div", { className: "mero-login-panel", style: { display: "grid", gap: 12, color: t.text }, children: [
    /* @__PURE__ */ jsx("p", { style: { margin: 0, color: t.textSecondary }, children: "Sign in with your passkey." }),
    note ? /* @__PURE__ */ jsx("p", { role: "status", style: { margin: 0, color: t.error }, children: note }) : null,
    /* @__PURE__ */ jsx("button", { type: "button", onClick: onEnrol, style: buttonStyle(t, true), children: "Continue with passkey" })
  ] });
}
function buttonStyle(t, primary) {
  return {
    padding: "10px 16px",
    borderRadius: t.radius,
    border: `1px solid ${primary ? t.primary : t.border}`,
    background: primary ? t.primary : t.backgroundSecondary,
    color: primary ? t.primaryText : t.text,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%"
  };
}
function LoginModal({ onConnect, onClose, isOpen, theme }) {
  const t = useMemo(() => resolveMeroTheme(theme), [theme]);
  const [url, setUrl] = useState(() => getNodeUrl() || defaultClusterUrl());
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!isOpen) {
      setBusy(false);
      setError(null);
    }
  }, [isOpen]);
  if (!isOpen || typeof document === "undefined") return null;
  const run = async (signUp) => {
    setBusy(true);
    setError(null);
    try {
      const target = url.trim().replace(/\/+$/, "");
      const instance = new CloudMero(target);
      if (signUp) await instance.signUp(name.trim() || "Calimero user");
      else await instance.signIn();
      instance.close();
      onConnect(target);
    } catch (err) {
      setError(passkeyMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const input = {
    padding: "10px 12px",
    borderRadius: t.radius,
    border: `1px solid ${t.border}`,
    background: t.backgroundSecondary,
    color: t.text,
    width: "100%",
    boxSizing: "border-box"
  };
  const content = /* @__PURE__ */ jsx(
    "div",
    {
      className: "mero-login-overlay",
      style: { position: "fixed", inset: 0, background: t.overlay, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1e4 },
      onClick: onClose,
      children: /* @__PURE__ */ jsxs(
        "div",
        {
          className: "mero-login-dialog",
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": "mero-login-title",
          style: { background: t.background, color: t.text, border: `1px solid ${t.border}`, borderRadius: t.radius, padding: 24, width: "min(420px, calc(100vw - 32px))", display: "grid", gap: 14, boxShadow: "var(--mero-login-shadow, 0 20px 60px rgba(0,0,0,.4))" },
          onClick: (e) => e.stopPropagation(),
          children: [
            /* @__PURE__ */ jsxs("div", { className: "mero-login-header", style: { display: "flex", alignItems: "center", gap: 12 }, children: [
              /* @__PURE__ */ jsx(CalimeroLogo, { size: 36, color: cssVar(t, "primary"), className: "mero-login-logo" }),
              /* @__PURE__ */ jsx("h1", { id: "mero-login-title", className: "mero-login-title", style: { margin: 0, fontSize: 20 }, children: creating ? "Create your account" : "Sign in to Calimero" }),
              /* @__PURE__ */ jsx("button", { className: "mero-login-close", onClick: onClose, "aria-label": "Close", style: { marginLeft: "auto", background: "none", border: "none", color: t.textSecondary, fontSize: 22, cursor: "pointer" }, children: "\xD7" })
            ] }),
            /* @__PURE__ */ jsxs("label", { style: { display: "grid", gap: 6, fontSize: 13, color: t.textSecondary }, children: [
              "Cluster",
              /* @__PURE__ */ jsx("input", { "aria-label": "Cluster URL", value: url, onChange: (e) => setUrl(e.target.value), style: input, spellCheck: false, autoComplete: "url" })
            ] }),
            creating ? /* @__PURE__ */ jsxs("label", { style: { display: "grid", gap: 6, fontSize: 13, color: t.textSecondary }, children: [
              "Your name",
              /* @__PURE__ */ jsx("input", { "aria-label": "Your name", value: name, onChange: (e) => setName(e.target.value), style: input, autoComplete: "name" })
            ] }) : null,
            error ? /* @__PURE__ */ jsx("p", { role: "alert", style: { margin: 0, color: t.error, fontSize: 14 }, children: error }) : null,
            /* @__PURE__ */ jsx("button", { type: "button", disabled: busy, onClick: () => void run(creating), style: buttonStyle(t, true), children: busy ? "Waiting for your passkey…" : creating ? "Create account with a passkey" : "Sign in with a passkey" }),
            /* @__PURE__ */ jsx("button", { type: "button", disabled: busy, onClick: () => {
              setCreating(!creating);
              setError(null);
            }, style: buttonStyle(t, false), children: creating ? "I already have an account" : "Create an account" })
          ]
        }
      )
    }
  );
  return createPortal(content, document.body);
}
function shortAccount(account) {
  return account.length > 14 ? `${account.slice(0, 6)}…${account.slice(-6)}` : account;
}
function ConnectButton({ className, style, theme, logoOnly = false, label }) {
  const { isAuthenticated, connectToNode, logout, isOnline, contextIdentity } = useMero();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const t = useMemo(() => resolveMeroTheme(theme), [theme]);
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setIsDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const overrides = typeof label === "string" ? { connect: label } : label;
  const text = !isAuthenticated ? overrides?.connect ?? "Connect" : isOnline ? overrides?.connected ?? "Connected" : overrides?.reconnecting ?? "Reconnecting...";
  return /* @__PURE__ */ jsxs("div", { ref: dropdownRef, className, style: { position: "relative", display: "inline-block", ...style }, children: [
    /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        className: "mero-connect-button",
        onClick: () => isAuthenticated ? setIsDropdownOpen((o) => !o) : setIsModalOpen(true),
        style: { ...buttonStyle(t, isAuthenticated), width: "auto", display: "inline-flex", alignItems: "center", gap: 8 },
        children: [
          /* @__PURE__ */ jsx(CalimeroLogo, { size: 18, color: isAuthenticated ? t.primaryText : t.primary }),
          logoOnly ? null : /* @__PURE__ */ jsx("span", { children: text })
        ]
      }
    ),
    isAuthenticated && isDropdownOpen ? /* @__PURE__ */ jsxs("div", { role: "menu", style: { position: "absolute", right: 0, top: "calc(100% + 6px)", background: t.background, border: `1px solid ${t.border}`, borderRadius: t.radius, padding: 8, minWidth: 200, zIndex: 1e3, display: "grid", gap: 6 }, children: [
      contextIdentity ? /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: t.textSecondary, padding: "4px 8px" }, title: contextIdentity, children: shortAccount(contextIdentity) }) : null,
      /* @__PURE__ */ jsx("button", { type: "button", role: "menuitem", onClick: () => {
        setIsDropdownOpen(false);
        logout();
      }, style: buttonStyle(t, false), children: "Sign out" })
    ] }) : null,
    /* @__PURE__ */ jsx(
      LoginModal,
      {
        isOpen: isModalOpen,
        onClose: () => setIsModalOpen(false),
        theme,
        onConnect: (url) => {
          setIsModalOpen(false);
          connectToNode(url);
        }
      }
    )
  ] });
}
function ConnectButtonAccount(props) {
  return /* @__PURE__ */ jsx(ConnectButton, { ...props });
}

function CalimeroLogo({
  size = 24,
  color,
  style,
  ...rest
}) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 193 193",
      fill: color ?? "currentColor",
      style,
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": "true",
      ...rest,
      children: [
        /* @__PURE__ */ jsx(
          "path",
          {
            fillRule: "evenodd",
            clipRule: "evenodd",
            d: "M13.5969 23.2235C63.4924 -4.81833 123.53 2.55678 148.374 10.0273C153.006 11.4201 155.606 16.2198 154.181 20.7478C152.757 25.2758 147.846 27.8173 143.214 26.4245C120.866 19.7045 66.3988 13.3369 22.3442 38.0961C21.3748 38.6409 20.8298 39.6384 20.8808 40.6778C22.5544 74.7376 40.6646 139.735 103.059 173.709C107.293 176.015 108.813 181.238 106.455 185.377C104.096 189.516 98.7523 191.002 94.5186 188.696C24.7767 150.721 5.18199 78.7606 3.35124 41.5008C2.98177 33.9812 6.96683 26.9496 13.5969 23.2235Z"
          }
        ),
        /* @__PURE__ */ jsx(
          "path",
          {
            fillRule: "evenodd",
            clipRule: "evenodd",
            d: "M180.214 22.5271C185.054 22.2785 189.183 25.9121 189.437 30.6429C192.776 92.7591 159.782 138.316 138.517 157.587C133.185 162.419 125.221 164.303 117.934 161.241C102.817 154.887 88.1835 141.52 76.3001 128.189C64.2403 114.66 54.1712 100.2 48.3006 90.492C45.8345 86.4139 47.2173 81.1537 51.3891 78.743C55.561 76.3323 60.9421 77.684 63.4082 81.7621C68.803 90.6832 78.2588 104.272 89.5315 116.919C100.981 129.763 113.488 140.698 124.866 145.48C125.179 145.612 125.851 145.671 126.586 145.006C145.206 128.132 174.903 87.1988 171.912 31.5431C171.657 26.8122 175.374 22.7756 180.214 22.5271Z"
          }
        ),
        /* @__PURE__ */ jsx(
          "path",
          {
            fillRule: "evenodd",
            clipRule: "evenodd",
            d: "M85.9137 55.4487C70.263 57.0264 57.2007 60.7039 50.4014 63.4262C45.9168 65.2218 40.7922 63.1236 38.9553 58.7397C37.1184 54.3559 39.2649 49.3464 43.7495 47.5508C52.2083 44.164 66.9167 40.1173 84.1135 38.3837C101.323 36.649 121.62 37.1693 140.947 43.4423C149.244 46.1351 155.088 53.9217 154.482 62.8728C153.225 81.429 144.514 100.403 127.158 122.145C124.177 125.88 118.663 126.546 114.842 123.631C111.021 120.717 110.341 115.327 113.322 111.592C129.481 91.3484 136.032 75.6017 136.971 61.7394C137.02 61.0029 136.547 60.0904 135.417 59.7238C119.18 54.4537 101.552 53.8722 85.9137 55.4487Z"
          }
        )
      ]
    }
  );
}

// src/theme.ts
var defaultMeroTheme = Object.freeze({
  primary: "#a5ff11",
  primaryHover: "#8ed40d",
  primaryText: "#0d1117",
  background: "#0d1117",
  backgroundSecondary: "#161b22",
  backgroundTertiary: "#1c2128",
  border: "#30363d",
  text: "#e6edf3",
  textSecondary: "#8b949e",
  error: "#ff6b6b",
  overlay: "rgba(0, 0, 0, 0.75)",
  radius: "8px"
});
function resolveMeroTheme(theme) {
  if (!theme) return { ...defaultMeroTheme };
  const filtered = Object.fromEntries(
    Object.entries(theme).filter(
      ([, v]) => v !== void 0 && typeof v === "string" && v.trim() !== ""
    )
  );
  return { ...defaultMeroTheme, ...filtered };
}
var MERO_CSS_VARS = {
  background: "--mero-bg",
  backgroundSecondary: "--mero-bg-secondary",
  backgroundTertiary: "--mero-bg-tertiary",
  text: "--mero-text",
  textSecondary: "--mero-text-secondary",
  primary: "--mero-accent",
  primaryHover: "--mero-accent-hover",
  primaryText: "--mero-on-primary",
  border: "--mero-border",
  error: "--mero-error",
  overlay: "--mero-overlay",
  radius: "--mero-radius"
};
function themeToCssVars(theme) {
  const vars = {};
  for (const key of Object.keys(MERO_CSS_VARS)) {
    vars[MERO_CSS_VARS[key]] = theme[key];
  }
  return vars;
}
function cssVar(theme, key) {
  return `var(${MERO_CSS_VARS[key]}, ${theme[key]})`;
}
// src/utils/base58.ts
var ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58ToHex(input) {
  const bytes = [];
  for (const char of input) {
    let carry = ALPHABET.indexOf(char);
    if (carry === -1) throw new Error(`invalid base58 character: ${char}`);
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 255;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 255);
      carry >>= 8;
    }
  }
  for (let k = 0; k < input.length && input[k] === "1"; k++) bytes.push(0);
  return bytes.reverse().map((b) => b.toString(16).padStart(2, "0")).join("");
}
var NO_EPHEMERAL_SURFACE_MESSAGE = "useEphemeral: this client has no `mero.ephemeral` surface. Ephemeral presence requires @calimero-network/mero-js >= 9.1.0; upgrade the installed @calimero-network/mero-js (and any lockfile pin) to use it.";
var COULD_NOT_RESOLVE_IDENTITY_MESSAGE = "useEphemeral: could not resolve a local context identity, so your own presence cannot be filtered out. Pass includeSelf: true to accept this.";
var REPLAY_RECONCILE_MS = 50;
function useEphemeral(contextId, options = {}) {
  const { includeSelf = false } = options;
  const { mero } = useMero();
  const ephemeral = mero ? mero.ephemeral ?? null : null;
  const [peers, setPeers] = useState(/* @__PURE__ */ new Map());
  const [latchedError, setLatchedError] = useState(null);
  const contextKeyRef = useRef(contextId);
  contextKeyRef.current = contextId;
  const setSourceError = useCallback(
    (source, err, key) => {
      if (key !== contextKeyRef.current) return;
      setLatchedError({ contextKey: key, source, error: err });
    },
    []
  );
  const clearSourceError = useCallback((source, key) => {
    setLatchedError(
      (prev) => prev && prev.source === source && prev.contextKey === key ? null : prev
    );
  }, []);
  const surfaceError = useMemo(
    () => mero && !ephemeral ? new Error(NO_EPHEMERAL_SURFACE_MESSAGE) : null,
    [mero, ephemeral]
  );
  const error = surfaceError ?? (latchedError && latchedError.contextKey === contextId && !(latchedError.source === "identity" && includeSelf) ? latchedError.error : null);
  const receivedAtRef = useRef(/* @__PURE__ */ new Map());
  const codecRef = useRef(options.codec);
  codecRef.current = options.codec;
  const initialRef = useRef(options.initial);
  initialRef.current = options.initial;
  const selfRef = useRef(null);
  const lastLocalRef = useRef(options.initial);
  const pendingRef = useRef(void 0);
  const timerRef = useRef(null);
  const lastSentAtRef = useRef(Date.now());
  const replaySeenRef = useRef(null);
  const replayTimerRef = useRef(null);
  const ageOf = useCallback((author) => {
    const at = receivedAtRef.current.get(author);
    return at === void 0 ? void 0 : Date.now() - at;
  }, []);
  useEffect(() => {
    setPeers(/* @__PURE__ */ new Map());
    receivedAtRef.current = /* @__PURE__ */ new Map();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (replayTimerRef.current) {
      clearTimeout(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    replaySeenRef.current = null;
    pendingRef.current = void 0;
    lastLocalRef.current = initialRef.current;
    selfRef.current = null;
    setLatchedError(null);
  }, [contextId]);
  useEffect(() => {
    if (!mero || !contextId) return;
    const key = contextId;
    let cancelled = false;
    mero.admin.getContextIdentitiesOwned(contextId).then((res) => {
      if (cancelled) return;
      const self = res.identities?.[0] ?? null;
      selfRef.current = self;
      if (!self) {
        setSourceError("identity", new Error(COULD_NOT_RESOLVE_IDENTITY_MESSAGE), key);
        return;
      }
      clearSourceError("identity", key);
      if (!includeSelf) {
        receivedAtRef.current.delete(self);
        setPeers((prev) => {
          if (!prev.has(self)) return prev;
          const next = new Map(prev);
          next.delete(self);
          return next;
        });
      }
    }).catch((err) => {
      if (!cancelled) {
        setSourceError("identity", toError(err), key);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mero, contextId, includeSelf, setSourceError, clearSourceError]);
  useEffect(() => {
    if (!ephemeral || !contextId) return;
    const closeReplayWindow = () => {
      replayTimerRef.current = null;
      const seen = replaySeenRef.current;
      replaySeenRef.current = null;
      if (!seen) return;
      setPeers((prev) => {
        let next = null;
        for (const author of prev.keys()) {
          if (seen.has(author)) continue;
          if (!next) next = new Map(prev);
          next.delete(author);
          receivedAtRef.current.delete(author);
        }
        return next ?? prev;
      });
    };
    const unsubscribe = ephemeral.subscribe(
      contextId,
      (entry) => {
        const { author, state } = entry;
        if (entry.ageMs !== void 0) {
          if (!replaySeenRef.current) replaySeenRef.current = /* @__PURE__ */ new Set();
          if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
          replayTimerRef.current = setTimeout(closeReplayWindow, REPLAY_RECONCILE_MS);
        }
        if (entry.removed || state === void 0) {
          replaySeenRef.current?.delete(author);
          receivedAtRef.current.delete(author);
          setPeers((prev) => {
            if (!prev.has(author)) return prev;
            const next = new Map(prev);
            next.delete(author);
            return next;
          });
          return;
        }
        if (!includeSelf && author === selfRef.current) return;
        replaySeenRef.current?.add(author);
        receivedAtRef.current.set(author, Date.now() - (entry.ageMs ?? 0));
        setPeers((prev) => new Map(prev).set(author, state));
      },
      codecRef.current
    );
    return () => {
      if (replayTimerRef.current) {
        clearTimeout(replayTimerRef.current);
        replayTimerRef.current = null;
      }
      replaySeenRef.current = null;
      unsubscribe();
    };
  }, [ephemeral, contextId, includeSelf]);
  const publish = useCallback((value) => {
    if (!ephemeral || !contextId) return;
    const key = contextId;
    lastSentAtRef.current = Date.now();
    void ephemeral.set(key, value, codecRef.current).then(
      () => clearSourceError("publish", key),
      (err) => setSourceError("publish", toError(err), key)
    );
  }, [ephemeral, contextId, setSourceError, clearSourceError]);
  const setPresence = useCallback((partial) => {
    const next = { ...lastLocalRef.current ?? {}, ...partial };
    lastLocalRef.current = next;
    const throttleMs = options.throttleMs ?? 30;
    if (throttleMs <= 0) {
      publish(next);
      return;
    }
    pendingRef.current = next;
    if (timerRef.current) return;
    const elapsed = Date.now() - lastSentAtRef.current;
    const delay = Math.max(throttleMs - elapsed, 0);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const queued = pendingRef.current;
      pendingRef.current = void 0;
      if (queued !== void 0) publish(queued);
    }, delay);
  }, [publish, options.throttleMs]);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
  return { peers, setPresence, ageOf, error };
}
function toError(err) {
  return err instanceof Error ? err : new Error(String(err));
}
function mapApplicationContexts(contexts) {
  return contexts.map((context) => ({
    contextId: context.id,
    applicationId: context.applicationId
  }));
}
function useMountedRef() {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}
function useAsyncMutation({ throwOnError = false } = {}) {
  const mountedRef = useMountedRef();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [failure, setFailure] = useState(null);
  const run = useCallback(
    async (action) => {
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
        setFailure(null);
      }
      try {
        return await action();
      } catch (err) {
        if (mountedRef.current) {
          setError(toError(err));
          setFailure(classifyError(err));
        }
        if (throwOnError) throw err;
        return null;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [mountedRef, throwOnError]
  );
  return { loading, error, failure, run, setError };
}
function useAsyncResource(fetcher, initialValue, deps) {
  const mountedRef = useMountedRef();
  const [data, setData] = useState(initialValue);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqRef = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const initialRef = useRef(initialValue);
  const refetch = useCallback(async () => {
    const seq = ++reqRef.current;
    const fn = fetcherRef.current;
    if (!fn) {
      if (mountedRef.current && seq === reqRef.current) {
        setData(initialRef.current);
        setError(null);
        setLoading(false);
      }
      return;
    }
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await fn();
      if (mountedRef.current && seq === reqRef.current) setData(result);
    } catch (err) {
      if (mountedRef.current && seq === reqRef.current) setError(toError(err));
    } finally {
      if (mountedRef.current && seq === reqRef.current) setLoading(false);
    }
  }, deps);
  const prevDeps = useRef(deps);
  if (deps.length !== prevDeps.current.length || deps.some((d, i) => !Object.is(d, prevDeps.current[i]))) {
    prevDeps.current = deps;
    reqRef.current += 1;
    setData(initialRef.current);
    setError(null);
  }
  useEffect(() => {
    void refetch();
  }, [refetch]);
  return { data, loading, error, refetch };
}
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
function extractAliasContextId(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  if ("value" in value && typeof value.value === "string") {
    return value.value;
  }
  if ("contextId" in value && typeof value.contextId === "string") {
    return value.contextId;
  }
  return null;
}
function useExecute(contextId, executorId) {
  const { mero, isDelegated } = useMero();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const execute = useCallback(
    async (method, params) => {
      if (!mero || !contextId || !executorId) {
        if (mountedRef.current) {
          setError(
            new Error(
              !mero && isDelegated ? "No relay for this account yet, so there is nowhere to send this write. Redeeming an invitation admits the account to a namespace and gives it a relay; reads and events resume with it." : "Not connected"
            )
          );
        }
        return null;
      }
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await mero.rpc.execute({
          contextId,
          method,
          argsJson: params,
          executorPublicKey: executorId
        });
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current) setError(e);
        return null;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [mero, contextId, executorId, isDelegated]
  );
  return { execute, loading, error };
}
function useSubscription(input, callback) {
  const { mero } = useMero();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const { contextIds = [], groupIds = [] } = Array.isArray(input) ? { contextIds: input, groupIds: [] } : input;
  const contextIdsKey = JSON.stringify(contextIds);
  const groupIdsKey = JSON.stringify(groupIds);
  useEffect(() => {
    if (!mero || contextIds.length === 0 && groupIds.length === 0) return;
    const sse = mero.events;
    const handler = (event) => {
      callbackRef.current(event);
    };
    sse.on("event", handler);
    sse.connect().catch(() => {
    });
    sse.subscribe({ contextIds, groupIds }).catch(() => {
    });
    return () => {
      sse.off("event", handler);
    };
  }, [mero, contextIdsKey, groupIdsKey]);
}
function useContexts(applicationId) {
  const { admin, isDelegated } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin ? async () => {
      if (isDelegated) {
        const session = readDelegatedSession();
        const listed = session ? await listDelegatedContexts(session) : [];
        const own = listed.filter(
          (c) => !applicationId || c.applicationId === applicationId
        );
        return mapApplicationContexts(own);
      }
      const response = applicationId ? await admin.getContextsForApplication(applicationId) : await admin.getContexts();
      return mapApplicationContexts(response.contexts ?? []);
    } : null,
    [],
    [admin, applicationId, isDelegated]
  );
  return { contexts: data, loading, error, refetch };
}
function useApplicationContexts(applicationId) {
  return useContexts(applicationId);
}
function useGroupMembers(groupId) {
  const { admin } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin && groupId ? () => admin.listGroupMembers(groupId) : null,
    null,
    [admin, groupId]
  );
  return {
    members: data?.members ?? [],
    loading,
    error,
    refetch
  };
}
function useGroupContexts(groupId) {
  const { admin } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin && groupId ? () => admin.listGroupContexts(groupId) : null,
    [],
    [admin, groupId]
  );
  return { contexts: data, loading, error, refetch };
}
function useGroupInvitations() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const createInvitation = useCallback(
    async (groupId, request) => {
      if (!admin) {
        return null;
      }
      return run(() => admin.createGroupInvitation(groupId, request));
    },
    [admin, run]
  );
  return { createInvitation, loading, error };
}
function useJoinGroup() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const joinGroup = useCallback(
    async (request) => {
      if (!admin) {
        return null;
      }
      return run(() => admin.joinGroup(request));
    },
    [admin, run]
  );
  return { joinGroup, loading, error };
}
function useGroupCapabilities(groupId, memberId) {
  const { admin } = useMero();
  const [capabilities, setCapabilitiesState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useMountedRef();
  const reqRef = useRef(0);
  const refetch = useCallback(async () => {
    const seq = ++reqRef.current;
    if (!admin || !groupId || !memberId) {
      if (mountedRef.current && seq === reqRef.current) {
        setCapabilitiesState(null);
        setError(null);
        setLoading(false);
      }
      return null;
    }
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await admin.getMemberCapabilities(groupId, memberId);
      if (mountedRef.current && seq === reqRef.current) {
        setCapabilitiesState(response.capabilities);
      }
      return response.capabilities;
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
      return null;
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, memberId, admin, mountedRef]);
  useEffect(() => {
    reqRef.current += 1;
    setCapabilitiesState(null);
    setError(null);
  }, [groupId, memberId]);
  useEffect(() => {
    void refetch();
  }, [refetch]);
  const setCapabilities = useCallback(
    async (nextCapabilities) => {
      if (!admin || !groupId || !memberId) {
        return null;
      }
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }
      try {
        await admin.setMemberCapabilities(groupId, memberId, { capabilities: nextCapabilities });
        if (mountedRef.current) {
          setCapabilitiesState(nextCapabilities);
        }
        return nextCapabilities;
      } catch (err) {
        const errorValue = toError(err);
        if (mountedRef.current) {
          setError(errorValue);
        }
        return null;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [groupId, memberId, admin, mountedRef]
  );
  return { capabilities, loading, error, refetch, setCapabilities };
}
function useContextDiscovery(options) {
  const { admin } = useMero();
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useMountedRef();
  const knownContextIdsKey = JSON.stringify(options.knownContextIds ?? []);
  const discover = useCallback(async () => {
    if (!admin) {
      const notConnectedError = new Error("Not connected");
      if (mountedRef.current) {
        setError(notConnectedError);
      }
      return null;
    }
    const knownContextIds = new Set(options.knownContextIds ?? []);
    const pollIntervalMs = options.pollIntervalMs ?? 1e3;
    const timeoutMs = options.timeoutMs ?? 3e4;
    const deadline = Date.now() + timeoutMs;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      while (Date.now() <= deadline) {
        if (options.targetAlias) {
          const aliasMatch = extractAliasContextId(
            await admin.lookupContextAlias(options.targetAlias)
          );
          if (aliasMatch && !knownContextIds.has(aliasMatch)) {
            const discoveredFromAlias = {
              contextId: aliasMatch,
              applicationId: options.applicationId
            };
            if (mountedRef.current) {
              setContext(discoveredFromAlias);
            }
            return discoveredFromAlias;
          }
        }
        const response = await admin.getContextsForApplication(options.applicationId);
        const contexts = mapApplicationContexts(response.contexts ?? []);
        const discovered = contexts.find(
          (applicationContext) => !knownContextIds.has(applicationContext.contextId)
        );
        if (discovered) {
          if (mountedRef.current) {
            setContext(discovered);
          }
          return discovered;
        }
        if (Date.now() + pollIntervalMs > deadline) {
          break;
        }
        await sleep(pollIntervalMs);
      }
      const timeoutError = new Error(
        `Timed out discovering a context for application ${options.applicationId}`
      );
      if (mountedRef.current) {
        setContext(null);
        setError(timeoutError);
      }
      return null;
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setContext(null);
        setError(errorValue);
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [
    knownContextIdsKey,
    admin,
    mountedRef,
    options.applicationId,
    options.knownContextIds,
    options.pollIntervalMs,
    options.targetAlias,
    options.timeoutMs
  ]);
  const reset = useCallback(() => {
    if (mountedRef.current) {
      setContext(null);
      setError(null);
      setLoading(false);
    }
  }, [mountedRef]);
  return { context, loading, error, discover, reset };
}
function useCreateContext() {
  const { admin, isDelegated } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const createContext2 = useCallback(
    async (request) => {
      if (isDelegated) {
        const session = readDelegatedSession();
        if (!session || !request.groupId) return null;
        return run(
          () => createDelegatedContext(session, {
            namespaceId: request.groupId,
            applicationId: request.applicationId,
            serviceName: request.serviceName,
            contextSeed: request.contextSeed,
            name: request.name,
            initializationParams: request.initializationParams
          })
        );
      }
      if (!admin) return null;
      return run(() => admin.createContext(request));
    },
    [admin, run, isDelegated]
  );
  return { createContext: createContext2, loading, error };
}
function useCreatePrivateContext() {
  const { admin, isDelegated } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const createPrivateContext = useCallback(
    async (request) => {
      if (isDelegated) {
        const session = readDelegatedSession();
        if (!session) return null;
        return run(() => createDelegatedPrivateContext(session, request));
      }
      if (!admin) return null;
      return run(async () => {
        const { groupId } = await admin.createGroupInNamespace(request.namespaceId, {
          visibility: "restricted"
        });
        await admin.addGroupMembers(groupId, {
          members: request.members.map((identity) => ({ identity, role: "Member" }))
        });
        const { contextId } = await admin.createContext({
          applicationId: request.applicationId,
          groupId,
          initializationParams: request.initializationParams
        });
        return { contextId };
      });
    },
    [admin, run, isDelegated]
  );
  return { createPrivateContext, loading, error };
}
function useDeleteContext() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const deleteContext = useCallback(
    async (contextId) => {
      if (!admin) return null;
      return run(() => admin.deleteContext(contextId));
    },
    [admin, run]
  );
  return { deleteContext, loading, error };
}
function useJoinContext(options = {}) {
  const { admin } = useMero();
  const { loading, error, failure, run } = useAsyncMutation(options);
  const joinContext = useCallback(
    async (contextId) => {
      if (!admin) return null;
      return run(() => admin.joinContext(contextId));
    },
    [admin, run]
  );
  return { joinContext, loading, error, failure };
}
function useJoinSubgroupInheritance() {
  const { admin, isDelegated } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const joinSubgroupInheritance = useCallback(
    async (groupId) => {
      if (isDelegated) {
        const session = readDelegatedSession();
        if (!session) return null;
        return run(async () => {
          await governRoot(session, groupId, memberJoinedOpenOp({ member: session.account, groupId, credential: session.credential }));
          const { publicKey } = await signerFromSecret(session.deviceSecret);
          return { groupId, memberPublicKey: publicKey, wasInherited: false };
        });
      }
      if (!admin) return null;
      return run(() => admin.joinSubgroupInheritance(groupId));
    },
    [admin, run, isDelegated]
  );
  return { joinSubgroupInheritance, loading, error };
}
function useContextGroup(contextId) {
  const { admin } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin && contextId ? () => admin.getContextGroup(contextId) : null,
    null,
    [admin, contextId]
  );
  return { groupId: data, loading, error, refetch };
}
function useGroupInfo(groupId) {
  const { admin } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin && groupId ? () => admin.getGroupInfo(groupId) : null,
    null,
    [admin, groupId]
  );
  return { groupInfo: data, loading, error, refetch };
}
function useDeleteGroup() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const deleteGroup = useCallback(
    async (groupId) => {
      if (!admin) return null;
      return run(() => admin.deleteGroup(groupId));
    },
    [admin, run]
  );
  return { deleteGroup, loading, error };
}
function useSyncGroup() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const syncGroup = useCallback(
    async (groupId) => {
      if (!admin) return null;
      return run(() => admin.syncGroup(groupId));
    },
    [admin, run]
  );
  return { syncGroup, loading, error };
}
function useAddGroupMembers() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const addGroupMembers = useCallback(
    async (groupId, request) => {
      if (!admin) return null;
      return run(() => admin.addGroupMembers(groupId, request));
    },
    [admin, run]
  );
  return { addGroupMembers, loading, error };
}
function useRemoveGroupMembers() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const removeGroupMembers = useCallback(
    async (groupId, request) => {
      if (!admin) return null;
      return run(() => admin.removeGroupMembers(groupId, request));
    },
    [admin, run]
  );
  return { removeGroupMembers, loading, error };
}
function useNamespaces() {
  const { admin } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin ? () => admin.listNamespaces() : null,
    [],
    [admin]
  );
  return { namespaces: data, loading, error, refetch };
}
function useNamespace(namespaceId) {
  const { admin } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin && namespaceId ? () => admin.getNamespace(namespaceId) : null,
    null,
    [admin, namespaceId]
  );
  return { namespace: data, loading, error, refetch };
}
function useNodeIdentity() {
  const { admin } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin ? () => admin.getNodeIdentity() : null,
    null,
    [admin]
  );
  return { identity: data, loading, error, refetch };
}
function useNamespacesForApplication(applicationId) {
  const { admin, isDelegated } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin && applicationId ? isDelegated ? async () => {
      const session = readDelegatedSession();
      const listed = session ? await listDelegatedNamespaces(session) : [];
      return listed.filter((ns) => ns.targetApplicationId === applicationId);
    } : () => admin.listNamespacesForApplication(applicationId) : null,
    [],
    [admin, applicationId, isDelegated]
  );
  return { namespaces: data, loading, error, refetch };
}
function useCreateNamespace() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const createNamespace = useCallback(
    async (request) => {
      if (!admin) return null;
      return run(() => admin.createNamespace(request));
    },
    [admin, run]
  );
  return { createNamespace, loading, error };
}
function useDeleteNamespace() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const deleteNamespace = useCallback(
    async (namespaceId) => {
      if (!admin) return null;
      return run(() => admin.deleteNamespace(namespaceId));
    },
    [admin, run]
  );
  return { deleteNamespace, loading, error };
}
function useCreateNamespaceInvitation() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const createNamespaceInvitation = useCallback(
    async (namespaceId, request) => {
      if (!admin) return null;
      return run(() => admin.createNamespaceInvitation(namespaceId, request));
    },
    [admin, run]
  );
  return { createNamespaceInvitation, loading, error };
}
function useJoinNamespace(options = {}) {
  const { admin } = useMero();
  const { loading, error, failure, run } = useAsyncMutation(options);
  const joinNamespace = useCallback(
    async (namespaceId, request) => {
      if (!admin) return null;
      return run(() => admin.joinNamespace(namespaceId, request));
    },
    [admin, run]
  );
  return { joinNamespace, loading, error, failure };
}
function useRedeemInvitation() {
  const { admin } = useMero();
  const mountedRef = useMountedRef();
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const redeem = useCallback(
    async (namespaceId, invitation, options = {}) => {
      if (!admin) return null;
      if (mountedRef.current) {
        setLoading(true);
        setOutcome(null);
      }
      try {
        const result = await admin.redeemInvitation(namespaceId, invitation, options);
        if (mountedRef.current) setOutcome(result);
        return result;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [admin, mountedRef]
  );
  return { redeem, outcome, loading };
}
function useCreateGroupInNamespace() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const createGroupInNamespace = useCallback(
    async (namespaceId, request) => {
      if (!admin) return null;
      return run(() => admin.createGroupInNamespace(namespaceId, request));
    },
    [admin, run]
  );
  return { createGroupInNamespace, loading, error };
}
function useNamespaceGroups(namespaceId) {
  const { admin } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin && namespaceId ? () => admin.listNamespaceGroups(namespaceId) : null,
    [],
    [admin, namespaceId]
  );
  return { groups: data, loading, error, refetch };
}
function useUpdateMemberRole() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const updateMemberRole = useCallback(
    async (groupId, identity, request) => {
      if (!admin) return null;
      return run(() => admin.updateMemberRole(groupId, identity, request));
    },
    [admin, run]
  );
  return { updateMemberRole, loading, error };
}
function useSetDefaultCapabilities() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const setDefaultCapabilities = useCallback(
    async (groupId, request) => {
      if (!admin) return null;
      return run(() => admin.setDefaultCapabilities(groupId, request));
    },
    [admin, run]
  );
  return { setDefaultCapabilities, loading, error };
}
function useSetSubgroupVisibility() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const setSubgroupVisibility = useCallback(
    async (groupId, request) => {
      if (!admin) return null;
      return run(() => admin.setSubgroupVisibility(groupId, request));
    },
    [admin, run]
  );
  return { setSubgroupVisibility, loading, error };
}
function useDefaultCapabilities(groupId) {
  const { admin } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin && groupId ? () => admin.getDefaultCapabilities(groupId) : null,
    null,
    [admin, groupId]
  );
  return { defaultCapabilities: data, loading, error, refetch };
}
function useSubgroupVisibility(groupId) {
  const { admin } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin && groupId ? () => admin.getSubgroupVisibility(groupId) : null,
    null,
    [admin, groupId]
  );
  return { subgroupVisibility: data, loading, error, refetch };
}
function useSetTeeAdmissionPolicy() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const setTeeAdmissionPolicy = useCallback(
    async (groupId, request) => {
      if (!admin) return null;
      return run(() => admin.setTeeAdmissionPolicy(groupId, request));
    },
    [admin, run]
  );
  return { setTeeAdmissionPolicy, loading, error };
}
function useSetGroupMetadata() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const setGroupMetadata = useCallback(
    async (groupId, request) => {
      if (!admin) return null;
      return run(() => admin.setGroupMetadata(groupId, request));
    },
    [admin, run]
  );
  return { setGroupMetadata, loading, error };
}
function useSetMemberMetadata() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const setMemberMetadata = useCallback(
    async (groupId, identity, request) => {
      if (!admin) return null;
      return run(() => admin.setMemberMetadata(groupId, identity, request));
    },
    [admin, run]
  );
  return { setMemberMetadata, loading, error };
}
function useSetContextMetadata() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const setContextMetadata = useCallback(
    async (groupId, contextId, request) => {
      if (!admin) return null;
      return run(() => admin.setContextMetadata(groupId, contextId, request));
    },
    [admin, run]
  );
  return { setContextMetadata, loading, error };
}
function useGroupMetadata(groupId) {
  const { admin } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin && groupId ? () => admin.getGroupMetadata(groupId) : null,
    null,
    [admin, groupId]
  );
  return { metadata: data, loading, error, refetch };
}
function useMemberMetadata(groupId, identity) {
  const { admin } = useMero();
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const prevKey = useRef(null);
  const key = `${groupId ?? ""}:${identity ?? ""}`;
  if (prevKey.current !== null && prevKey.current !== key) {
    setMetadata(null);
    setError(null);
  }
  prevKey.current = key;
  const run = useCallback(
    async (signal) => {
      if (!admin || !groupId || !identity) {
        if (!signal.aborted) {
          setMetadata(null);
          setError(null);
          setLoading(false);
        }
        return;
      }
      if (!signal.aborted) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await admin.getMemberMetadata(groupId, identity);
        if (!signal.aborted) setMetadata(result);
      } catch (err) {
        if (!signal.aborted) setError(toError(err));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [admin, groupId, identity]
  );
  useEffect(() => {
    const signal = { aborted: false };
    void run(signal);
    return () => {
      signal.aborted = true;
    };
  }, [run]);
  const refetch = useCallback(async () => {
    const signal = { aborted: false };
    await run(signal);
  }, [run]);
  return { metadata, loading, error, refetch };
}
function useUpgradeGroup() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const upgradeGroup = useCallback(
    async (groupId, request) => {
      if (!admin) return null;
      return run(() => admin.upgradeGroup(groupId, request));
    },
    [admin, run]
  );
  return { upgradeGroup, loading, error };
}
function useInstallFromRegistry() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const installFromRegistry = useCallback(
    async (packageName, version) => {
      if (!admin) return null;
      return run(() => admin.installApplication({ package: packageName, version }));
    },
    [admin, run]
  );
  return { installFromRegistry, loading, error };
}
function useResyncContext() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const resyncContext = useCallback(
    async (contextId, request = {}) => {
      if (!admin) return null;
      return run(() => admin.resyncContext(contextId, request));
    },
    [admin, run]
  );
  return { resyncContext, loading, error };
}
function useGroupUpgradeStatus(groupId) {
  const { admin } = useMero();
  const [upgradeStatus, setUpgradeStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useMountedRef();
  const reqRef = useRef(0);
  const refetch = useCallback(async () => {
    const seq = ++reqRef.current;
    if (!admin || !groupId) {
      if (mountedRef.current) {
        setUpgradeStatus(null);
        setError(null);
        setLoading(false);
      }
      return;
    }
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await admin.getGroupUpgradeStatus(groupId);
      if (mountedRef.current && seq === reqRef.current) {
        setUpgradeStatus(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, admin, mountedRef]);
  useEffect(() => {
    reqRef.current += 1;
    setUpgradeStatus(null);
    setError(null);
  }, [groupId]);
  useEffect(() => {
    void refetch();
  }, [refetch]);
  return { upgradeStatus, loading, error, refetch };
}
function useRetryGroupUpgrade() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const retryGroupUpgrade = useCallback(
    async (groupId) => {
      if (!admin) return null;
      return run(() => admin.retryGroupUpgrade(groupId));
    },
    [admin, run]
  );
  return { retryGroupUpgrade, loading, error };
}
function useReparentGroup() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const reparentGroup = useCallback(
    async (childGroupId, request) => {
      if (!admin) return null;
      return run(() => admin.reparentGroup(childGroupId, request));
    },
    [admin, run]
  );
  return { reparentGroup, loading, error };
}
function useSubgroups(groupId) {
  const { admin } = useMero();
  const { data, loading, error, refetch } = useAsyncResource(
    admin && groupId ? () => admin.listSubgroups(groupId) : null,
    [],
    [admin, groupId]
  );
  return { subgroups: data, loading, error, refetch };
}
function useDetachContextFromGroup() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const detachContextFromGroup = useCallback(
    async (groupId, contextId) => {
      if (!admin) return null;
      return run(() => admin.detachContextFromGroup(groupId, contextId));
    },
    [admin, run]
  );
  return { detachContextFromGroup, loading, error };
}
var DEFAULT_MIGRATION_POLL_INTERVAL_MS = 5e3;
function useMigrationEvents(namespaceId, onEvent) {
  const { mero } = useMero();
  const mountedRef = useMountedRef();
  const [live, setLive] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  useEffect(() => {
    if (!mero || !namespaceId) return;
    const sse = mero.events;
    const unsubscribe = sse.onMigrationEvent((event) => handlerRef.current(event));
    let cancelled = false;
    void (async () => {
      try {
        await sse.connect();
        await sse.subscribe({ groupIds: [namespaceId] });
        if (!cancelled && mountedRef.current) setLive(true);
      } catch {
        if (!cancelled && mountedRef.current) setLive(false);
      }
    })();
    return () => {
      cancelled = true;
      if (mountedRef.current) setLive(false);
      unsubscribe();
    };
  }, [mero, namespaceId, mountedRef]);
  return live;
}
function useMigrationStatus(namespaceId, options) {
  const { admin } = useMero();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useMountedRef();
  const reqRef = useRef(0);
  const refetch = useCallback(async () => {
    if (!admin || !namespaceId) {
      if (mountedRef.current) {
        setStatus(null);
        setError(null);
        setLoading(false);
      }
      return;
    }
    const seq = ++reqRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await admin.getMigrationStatus(namespaceId);
      if (mountedRef.current && seq === reqRef.current) {
        setStatus(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [namespaceId, admin, mountedRef]);
  useEffect(() => {
    setStatus(null);
    setError(null);
  }, [namespaceId]);
  useEffect(() => {
    void refetch();
  }, [refetch]);
  const sseLive = useMigrationEvents(namespaceId, () => void refetch());
  const pollIntervalMs = options?.pollIntervalMs ?? (sseLive ? void 0 : DEFAULT_MIGRATION_POLL_INTERVAL_MS);
  useEffect(() => {
    if (!pollIntervalMs || !admin || !namespaceId) return;
    const handle = setInterval(() => void refetch(), pollIntervalMs);
    return () => clearInterval(handle);
  }, [pollIntervalMs, admin, namespaceId, refetch]);
  const rollup = status?.rollup ?? null;
  const members = status?.members ?? [];
  return {
    status,
    rollup,
    members,
    allMigrated: rollup?.allMigrated ?? false,
    /**
     * When this node watched the fleet converge, or `null`. Durable, unlike
     * `allMigrated`, which is recomputed from in-TTL heartbeats and lapses back
     * to false when a member simply goes quiet.
     */
    fleetCompletedAt: status?.fleetCompletedAt ?? null,
    membersPendingSignature: rollup?.membersPendingSignature ?? 0,
    /** Members whose migrate aborted (migration-check failed or apply errored). */
    failed: rollup?.failed ?? 0,
    loading,
    error,
    refetch
  };
}
function useAppVersion(contextId, expected) {
  const { mero, admin } = useMero();
  const [appVersion, setAppVersion] = useState(void 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useMountedRef();
  const reqRef = useRef(0);
  const refetch = useCallback(async () => {
    if (!admin || !contextId) {
      if (mountedRef.current) {
        setAppVersion(void 0);
        setError(null);
        setLoading(false);
      }
      return;
    }
    const seq = ++reqRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const context = await admin.getContext(contextId);
      if (mountedRef.current && seq === reqRef.current) {
        setAppVersion(context.applicationVersion);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [contextId, admin, mountedRef]);
  useEffect(() => {
    setAppVersion(void 0);
    setError(null);
  }, [contextId]);
  useEffect(() => {
    void refetch();
  }, [refetch]);
  useEffect(() => {
    if (!mero?.events || !contextId) return;
    const off = mero.events.onAppVersionChanged((event) => {
      if (event.contextId !== contextId) return;
      if (mountedRef.current && event.toVersion) {
        reqRef.current += 1;
        setAppVersion(event.toVersion);
      }
    });
    return off;
  }, [mero, contextId, mountedRef]);
  const isStale = appVersion != null && expected != null && appVersion !== expected;
  return { appVersion, expected, isStale, loading, error, refetch };
}
function useLatestVersion(registryUrl, packageName, currentVersion) {
  const { admin } = useMero();
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useMountedRef();
  const reqRef = useRef(0);
  const refetch = useCallback(async () => {
    if (!admin || !registryUrl || !packageName) {
      reqRef.current += 1;
      if (mountedRef.current) {
        setVersions([]);
        setError(null);
        setLoading(false);
      }
      return;
    }
    const seq = ++reqRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await admin.getRegistryVersions(registryUrl, packageName);
      if (mountedRef.current && seq === reqRef.current) {
        setVersions(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [admin, registryUrl, packageName, mountedRef]);
  useEffect(() => {
    setVersions([]);
    setError(null);
  }, [registryUrl, packageName]);
  useEffect(() => {
    void refetch();
  }, [refetch]);
  const latestVersion = versions[0] ?? null;
  const updateAvailable = latestVersion != null && currentVersion != null && compareSemver(latestVersion, currentVersion) > 0;
  return { versions, latestVersion, currentVersion, updateAvailable, loading, error, refetch };
}
var EMPTY_GROUP_APP_VERSION = {
  version: null,
  applicationId: null,
  pendingApply: false,
  activeUpgrade: null
};
function isZeroAppKey(appKey) {
  return !appKey || /^0+$/.test(appKey);
}
function useGroupAppVersion(groupId) {
  const { mero, admin } = useMero();
  const [data, setData] = useState(EMPTY_GROUP_APP_VERSION);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useMountedRef();
  const reqRef = useRef(0);
  const refetch = useCallback(async () => {
    const seq = ++reqRef.current;
    if (!admin || !groupId) {
      if (mountedRef.current) {
        setData(EMPTY_GROUP_APP_VERSION);
        setError(null);
        setLoading(false);
      }
      return;
    }
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const namespaces = await admin.listNamespaces();
      const namespace = namespaces.find((entry) => entry.namespaceId === groupId);
      let appKey;
      let applicationId;
      let activeUpgrade = null;
      if (namespace) {
        appKey = namespace.appKey;
        applicationId = namespace.targetApplicationId;
      } else {
        const info = await admin.getGroupInfo(groupId);
        appKey = info.appKey;
        applicationId = info.targetApplicationId;
        activeUpgrade = info.activeUpgrade ?? null;
      }
      let version = null;
      let pendingApply = false;
      if (applicationId) {
        const { application } = await admin.getApplication(applicationId);
        version = application?.version ?? null;
        if (application && !isZeroAppKey(appKey)) {
          const installedHex = base58ToHex(application.blob.bytecode).toLowerCase();
          pendingApply = appKey.toLowerCase() !== installedHex;
        }
      }
      if (mountedRef.current && seq === reqRef.current) {
        setData({ version, applicationId, pendingApply, activeUpgrade });
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, admin, mountedRef]);
  useEffect(() => {
    reqRef.current += 1;
    setData(EMPTY_GROUP_APP_VERSION);
    setError(null);
  }, [groupId]);
  useEffect(() => {
    void refetch();
  }, [refetch]);
  useEffect(() => {
    if (!mero?.events || !groupId) return;
    const off = mero.events.onAppVersionChanged(() => {
      if (mountedRef.current) void refetch();
    });
    return off;
  }, [mero, groupId, refetch, mountedRef]);
  return { ...data, loading, error, refetch };
}
function useMyAuthoredMigration(contextId) {
  const { mero } = useMero();
  const [summary, setSummary] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const mountedRef = useMountedRef();
  const { loading, error, run } = useAsyncMutation();
  const reqRef = useRef(0);
  const refresh = useCallback(async () => {
    if (!mero || !contextId) {
      if (mountedRef.current) setPendingCount(0);
      return;
    }
    const seq = ++reqRef.current;
    try {
      const count = await mero.rpc.countMyPending(contextId);
      if (mountedRef.current && seq === reqRef.current) setPendingCount(count);
    } catch {
    }
  }, [mero, contextId, mountedRef]);
  useEffect(() => {
    reqRef.current += 1;
    setPendingCount(0);
    setSummary(null);
  }, [contextId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const authorize = useCallback(async () => {
    if (!mero || !contextId) return null;
    const result = await run(() => mero.rpc.migrateMyEntries(contextId));
    if (result && mountedRef.current) {
      reqRef.current += 1;
      setSummary(result);
      setPendingCount(result.remaining);
    }
    return result;
  }, [mero, contextId, run, mountedRef]);
  return {
    summary,
    pendingCount,
    pending: pendingCount > 0,
    authorize,
    loading,
    error,
    refresh
  };
}
function isBlobNotFound(error) {
  return !!error && error.status === 404;
}
function useBlobInfo(blobId, options) {
  const { admin } = useMero();
  const contextId = options?.contextId;
  const { data, loading, error, refetch } = useAsyncResource(
    admin && blobId ? () => admin.getBlobInfo(blobId, contextId ? { contextId } : void 0) : null,
    null,
    [admin, blobId, contextId]
  );
  return { info: data, notFound: isBlobNotFound(error), loading, error, refetch };
}
function useBlobUrl(blobId, options) {
  const { admin } = useMero();
  const contextId = options?.contextId;
  const type = options?.type;
  const mountedRef = useMountedRef();
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqRef = useRef(0);
  const urlRef = useRef(null);
  const revoke = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);
  const refetch = useCallback(async () => {
    const seq = ++reqRef.current;
    if (!admin || !blobId) return;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const bytes = await admin.getBlob(blobId, contextId ? { contextId } : void 0);
      if (!mountedRef.current || seq !== reqRef.current) return;
      revoke();
      const objectUrl = URL.createObjectURL(new Blob([bytes], type ? { type } : void 0));
      urlRef.current = objectUrl;
      setUrl(objectUrl);
    } catch (err) {
      if (mountedRef.current && seq === reqRef.current) setError(toError(err));
    } finally {
      if (mountedRef.current && seq === reqRef.current) setLoading(false);
    }
  }, [admin, blobId, contextId, type, revoke, mountedRef]);
  useEffect(() => {
    reqRef.current += 1;
    revoke();
    setUrl(null);
    setError(null);
    setLoading(false);
  }, [admin, blobId, contextId, type, revoke]);
  useEffect(() => {
    void refetch();
  }, [refetch]);
  useEffect(() => revoke, [revoke]);
  return { url, notFound: isBlobNotFound(error), loading, error, refetch };
}
function useUploadBlob() {
  const { admin } = useMero();
  const { loading, error, run } = useAsyncMutation();
  const uploadBlob = useCallback(
    async (request) => {
      if (!admin) return null;
      return run(() => admin.uploadBlob(request));
    },
    [admin, run]
  );
  return { uploadBlob, loading, error };
}
function MigrationPendingBanner({
  contextId,
  className,
  children,
  onMigrated
}) {
  const { pending, pendingCount, authorize, loading } = useMyAuthoredMigration(contextId);
  if (!pending) return null;
  const handleClick = async () => {
    const result = await authorize();
    if (result && result.remaining === 0) {
      onMigrated?.();
    }
  };
  const message = children ?? `You have ${pendingCount} ${pendingCount === 1 ? "entry" : "entries"} to re-sign after a recent upgrade.`;
  return /* @__PURE__ */ jsxs("div", { className, "data-testid": "migration-pending-banner", role: "status", children: [
    /* @__PURE__ */ jsx("span", { children: message }),
    /* @__PURE__ */ jsx("button", { type: "button", onClick: handleClick, disabled: loading, children: loading ? "Migrating\u2026" : "Migrate my data" })
  ] });
}
function MigrationAdminPanel({ namespaceId, pollIntervalMs, className }) {
  const { status, rollup, members, membersPendingSignature, failed, error } = useMigrationStatus(
    namespaceId,
    { pollIntervalMs }
  );
  if (error && !status) {
    return /* @__PURE__ */ jsxs("div", { className, "data-testid": "migration-admin-panel", children: [
      "Failed to load migration status: ",
      error.message
    ] });
  }
  if (!status || !rollup) {
    return /* @__PURE__ */ jsx("div", { className, "data-testid": "migration-admin-panel", children: "Loading migration status\u2026" });
  }
  return /* @__PURE__ */ jsxs("div", { className, "data-testid": "migration-admin-panel", children: [
    error && // A poll failed after data was already loaded — keep showing the last
    // good rollup but flag that it may be stale.
    /* @__PURE__ */ jsxs("div", { "data-testid": "migration-status-error", role: "alert", children: [
      "Could not refresh migration status: ",
      error.message
    ] }),
    /* @__PURE__ */ jsxs("dl", { children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "Target version" }),
        /* @__PURE__ */ jsx("dd", { children: status.targetVersion })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "Migrated" }),
        /* @__PURE__ */ jsx("dd", { children: rollup.migrated })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "In progress" }),
        /* @__PURE__ */ jsx("dd", { children: rollup.inProgress })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "Unknown" }),
        /* @__PURE__ */ jsx("dd", { children: rollup.unknown })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "Failed" }),
        /* @__PURE__ */ jsx("dd", { "data-testid": "migration-failed-count", children: failed })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "Total" }),
        /* @__PURE__ */ jsx("dd", { children: rollup.total })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "All migrated" }),
        /* @__PURE__ */ jsx("dd", { children: rollup.allMigrated ? "yes" : "no" })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "Members pending signature" }),
        /* @__PURE__ */ jsx("dd", { "data-testid": "members-pending-signature", children: membersPendingSignature })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("table", { children: [
      /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx("th", { children: "Peer" }),
        /* @__PURE__ */ jsx("th", { children: "State" }),
        /* @__PURE__ */ jsx("th", { children: "Schema" }),
        /* @__PURE__ */ jsx("th", { children: "Pending" }),
        /* @__PURE__ */ jsx("th", { children: "Reason" })
      ] }) }),
      /* @__PURE__ */ jsx("tbody", { children: members.map((m) => /* @__PURE__ */ jsxs("tr", { "data-testid": "migration-member-row", children: [
        /* @__PURE__ */ jsx("td", { children: m.peer }),
        /* @__PURE__ */ jsx("td", { children: m.state }),
        /* @__PURE__ */ jsx("td", { children: m.report?.schemaVersion ?? "\u2014" }),
        /* @__PURE__ */ jsx("td", { children: m.report?.authoredRemaining ?? "\u2014" }),
        /* @__PURE__ */ jsx("td", { children: m.report?.migrationFailed ?? "\u2014" })
      ] }, m.peer)) })
    ] })
  ] });
}
function useDelegatedBootstrap(options = {}) {
  const { connectWithAccount, cloudBaseUrl: providerCloud } = useMero();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const read2 = readDelegatedCredential();
  const credential = useMemo(
    () => read2,
    // Keyed on the contents, not the parsed object.
    [read2?.account, read2?.credential, read2?.deviceSecret]
  );
  const relayUrl = readDelegatedSession()?.relayUrl ?? null;
  const cloudBaseUrl = options.cloudBaseUrl ?? providerCloud;
  const bootstrap = useCallback(
    async (input) => {
      const held = readDelegatedCredential();
      if (!held) {
        const failure = {
          ok: false,
          step: "no-credential",
          reason: "This tab holds no enrolled account, so there is no identity to admit. Enrol with your account first \u2014 the invitation is then what gives it its first membership."
        };
        setResult(failure);
        return failure;
      }
      setRunning(true);
      try {
        const outcome = await bootstrapFromInvitation({
          namespaceId: input.namespaceId,
          invitation: input.invitation,
          credential: held,
          nodeUrl: input.nodeUrl,
          cloudBaseUrl
        });
        setResult(outcome);
        if (outcome.ok) {
          if (outcome.session.relayUrl) {
            rememberRelay(held.account, outcome.session.relayUrl, {
              namespaceId: input.namespaceId,
              contextId: input.contextId
            });
          }
          connectWithAccount(carryExecutorAccount(readDelegatedSession(), outcome.session));
        }
        return outcome;
      } finally {
        setRunning(false);
      }
    },
    [cloudBaseUrl, connectWithAccount]
  );
  return {
    credential,
    needsBootstrap: credential !== null && relayUrl === null,
    running,
    result,
    bootstrap
  };
}

// node_modules/.pnpm/@calimero-network+mero-platform@0.1.0/node_modules/@calimero-network/mero-platform/dist/bridge/index.js
function getBridge() {
  if (typeof window === "undefined")
    return null;
  const b = window.__calimero_platform__;
  if (!b || typeof b !== "object")
    return null;
  const bridge = b;
  if (typeof bridge.version !== "number" || !Array.isArray(bridge.capabilities) || typeof bridge.invoke !== "function" || typeof bridge.on !== "function") {
    return null;
  }
  return bridge;
}

// node_modules/.pnpm/@calimero-network+mero-platform@0.1.0/node_modules/@calimero-network/mero-platform/dist/deep-link/link.js
var DEFAULT_HOST = "https://links.calimero.network";
function createLink(slug, action, params = {}, host = DEFAULT_HOST) {
  const base = host.replace(/\/+$/, "");
  const path = `${encodeURIComponent(slug)}/${encodeURIComponent(action)}`;
  const url = new URL(`${base}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

// node_modules/.pnpm/@calimero-network+mero-platform@0.1.0/node_modules/@calimero-network/mero-platform/dist/deep-link/pending-intent.js
var STORAGE_KEY = "calimero.platform.pendingIntents";
function hashNonce(raw) {
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
var PendingIntentStore = class {
  constructor(storage2, now = () => Date.now()) {
    this.storage = storage2;
    this.now = now;
  }
  read() {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw)
        return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  write(list) {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
    }
  }
  /** Capture an intent; idempotent by content nonce. Returns the stored entry. */
  capture(raw) {
    const nonce = hashNonce(raw);
    const list = this.read();
    const existing = list.find((i) => i.nonce === nonce);
    if (existing)
      return existing;
    const intent = { nonce, raw, capturedAt: this.now() };
    this.write([...list, intent]);
    return intent;
  }
  /** The oldest unacked intent, or null. */
  peek() {
    return this.read()[0] ?? null;
  }
  /** All unacked intents, oldest first. */
  all() {
    return this.read();
  }
  /** Drop an intent once the app has handled it. */
  ack(nonce) {
    this.write(this.read().filter((i) => i.nonce !== nonce));
  }
};

// node_modules/.pnpm/@calimero-network+mero-platform@0.1.0/node_modules/@calimero-network/mero-platform/dist/deep-link/index.js
function parseIntent(raw) {
  const params = {};
  let slug = null;
  let action = null;
  try {
    if (/^calimero:\/\//i.test(raw)) {
      const rest = raw.slice("calimero://".length);
      const qIdx = rest.indexOf("?");
      const pathPart = qIdx >= 0 ? rest.slice(0, qIdx) : rest;
      const queryPart = qIdx >= 0 ? rest.slice(qIdx + 1) : "";
      const segs = pathPart.split("/").filter(Boolean);
      slug = segs[0] ?? null;
      action = segs[1] ?? null;
      new URLSearchParams(queryPart).forEach((v, k) => params[k] = v);
    } else {
      const url = new URL(raw, "https://x.invalid/");
      const segs = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
      slug = segs[0] ?? null;
      action = segs[1] ?? null;
      url.searchParams.forEach((v, k) => params[k] = v);
    }
  } catch {
  }
  return { slug, action, params };
}
function hasIntentSignal(href) {
  try {
    const url = new URL(href, "https://x.invalid/");
    const segs = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    return url.search.length > 1 || segs.length > 0;
  } catch {
    return false;
  }
}
var DeepLinkController = class {
  constructor(store, sources = {}) {
    this.store = store;
    this.handlers = /* @__PURE__ */ new Set();
    this.delivered = /* @__PURE__ */ new Set();
    this.unsubscribers = [];
    if (sources.location?.href && hasIntentSignal(sources.location.href)) {
      this.capture(sources.location.href);
    }
    if (sources.bridge) {
      const off = sources.bridge.on("deep-link", (payload) => {
        const raw = extractRaw(payload);
        if (raw)
          this.capture(raw);
      });
      this.unsubscribers.push(off);
    }
    if (sources.launchQueue) {
      sources.launchQueue.setConsumer((p) => {
        if (p?.targetURL && hasIntentSignal(p.targetURL))
          this.capture(p.targetURL);
      });
    }
  }
  /** Register an intent handler; immediately replays buffered (unacked,
   * not-yet-delivered) intents. Returns an unsubscribe fn. */
  on(handler) {
    this.handlers.add(handler);
    for (const stored of this.store.all()) {
      if (!this.delivered.has(stored.nonce)) {
        this.delivered.add(stored.nonce);
        handler(this.toIntent(stored));
      }
    }
    return () => this.handlers.delete(handler);
  }
  /** Tear down source subscriptions + handlers. */
  dispose() {
    for (const off of this.unsubscribers.splice(0))
      off();
    this.handlers.clear();
  }
  capture(raw) {
    const stored = this.store.capture(raw);
    if (this.delivered.has(stored.nonce) || this.handlers.size === 0)
      return;
    this.delivered.add(stored.nonce);
    const intent = this.toIntent(stored);
    for (const handler of this.handlers)
      handler(intent);
  }
  toIntent(stored) {
    return {
      raw: stored.raw,
      ...parseIntent(stored.raw),
      resolve: () => this.store.ack(stored.nonce)
    };
  }
};
function extractRaw(payload) {
  if (typeof payload === "string")
    return payload;
  if (payload && typeof payload === "object") {
    const o = payload;
    if (typeof o.raw === "string")
      return o.raw;
    if (typeof o.url === "string")
      return o.url;
  }
  return null;
}

// src/invitations/capture.ts
var JOIN_ACTION = "join";
var INVITATION_PARAM = "invitation";
function buildInviteLink(slug, token, extra = {}) {
  const params = { [INVITATION_PARAM]: token };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== void 0 && value !== "") params[key] = value;
  }
  return createLink(slug, JOIN_ACTION, params);
}
var watchers = /* @__PURE__ */ new Set();
function notifyWatchers() {
  for (const watcher of watchers) watcher();
}
var MAX_AUTO_JOIN_ATTEMPTS = 3;
var listeners = /* @__PURE__ */ new Set();
var buffered = null;
var current = null;
var controller = null;
var attemptsKey = "calimero:invitation-attempts";
var ownSlugs = /* @__PURE__ */ new Set();
function memoryStorage() {
  const map = /* @__PURE__ */ new Map();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v)
  };
}
function storage() {
  try {
    const probe = "__calimero_invite_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}
function readAttempts() {
  try {
    const parsed = JSON.parse(storage().getItem(attemptsKey) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeAttempts(attempts) {
  try {
    storage().setItem(attemptsKey, JSON.stringify(attempts));
  } catch {
  }
}
function spendAttempt(token) {
  const attempts = readAttempts();
  const spent = attempts[token] ?? 0;
  if (spent >= MAX_AUTO_JOIN_ATTEMPTS) return false;
  attempts[token] = spent + 1;
  writeAttempts(attempts);
  return true;
}
function forgetAttempts(token) {
  const attempts = readAttempts();
  if (!(token in attempts)) return;
  delete attempts[token];
  writeAttempts(attempts);
}
function invitationFromRaw(raw) {
  const direct = raw.trim();
  if (!direct) return null;
  try {
    const params = new URLSearchParams(
      direct.includes("?") ? direct.slice(direct.indexOf("?") + 1) : direct
    );
    const found = params.get(INVITATION_PARAM);
    if (found && found.trim()) return found.trim();
  } catch {
  }
  if (direct.includes("=") || direct.includes("?")) return null;
  if (direct.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(direct)) return null;
  return direct;
}
function urlWithoutInvitation(href) {
  try {
    const url = new URL(href);
    if (!url.searchParams.has(INVITATION_PARAM)) return href;
    url.searchParams.delete(INVITATION_PARAM);
    return url.toString();
  } catch {
    return href;
  }
}
function deliver(invitation) {
  current = invitation;
  notifyWatchers();
  if (listeners.size === 0) {
    buffered = invitation;
    return;
  }
  for (const listener of listeners) listener(invitation);
}
function ensureController() {
  if (controller) return;
  controller = new DeepLinkController(new PendingIntentStore(storage()), {
    location: typeof window !== "undefined" ? window.location : null,
    bridge: getBridge(),
    launchQueue: typeof window !== "undefined" ? window.launchQueue ?? null : null
  });
  controller.on((intent) => {
    if (intent.action !== null && intent.action !== JOIN_ACTION && !intent.params[INVITATION_PARAM]) {
      return;
    }
    if (intent.action === JOIN_ACTION && intent.slug !== null && ownSlugs.size > 0 && !ownSlugs.has(intent.slug)) {
      intent.resolve();
      return;
    }
    const token = invitationFromRaw(intent.raw);
    if (!token) {
      intent.resolve();
      return;
    }
    try {
      const cleaned = urlWithoutInvitation(window.location.href);
      if (cleaned !== window.location.href) {
        window.history.replaceState(null, "", cleaned);
      }
    } catch {
    }
    deliver({
      token,
      params: { ...intent.params, [INVITATION_PARAM]: token },
      resolve: () => {
        forgetAttempts(token);
        if (buffered?.token === token) buffered = null;
        intent.resolve();
        if (current?.token === token) {
          current = null;
          notifyWatchers();
        }
      },
      autoJoin: spendAttempt(token)
    });
  });
}
function primeInvitationCapture(appKey, options = {}) {
  if (appKey) attemptsKey = `${appKey}:invitation-attempts`;
  const { slug } = options;
  if (slug) ownSlugs = new Set(typeof slug === "string" ? [slug] : slug);
  ensureController();
}
function onInvitation(listener) {
  ensureController();
  listeners.add(listener);
  if (buffered) {
    const pending = buffered;
    buffered = null;
    listener(pending);
  }
  return () => {
    listeners.delete(listener);
  };
}
function peekInvitation() {
  ensureController();
  return current;
}
function subscribeInvitation(watcher) {
  ensureController();
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}
function resetInvitationCaptureForTests() {
  controller?.dispose();
  controller = null;
  listeners.clear();
  buffered = null;
  current = null;
  attemptsKey = "calimero:invitation-attempts";
  ownSlugs = /* @__PURE__ */ new Set();
  notifyWatchers();
}

// src/invitations/describeInviteFailure.ts
function describeInviteFailure(reason, noun = "team") {
  switch (reason) {
    case "expired":
      return "This invitation has expired. Ask for a new link.";
    case "invalid":
      return "This invitation link isn't valid. Ask for a new one.";
    case "already-used":
      return `You've already used this link to join this ${noun} once. Ask an admin for a new link.`;
    case "removed":
      return `An admin removed you from this ${noun}. A new link won't let you back in; ask an admin to add you again.`;
    case "refused":
      return `You can't join this ${noun} with this invitation. Ask an admin to invite you again.`;
    case "signed-out":
      return "Your session with your node has ended. Sign in again to finish joining.";
    case "no-one-online":
      return `No one in this ${noun} is online to let you in yet. It will try again the next time you open the app.`;
    case "node-unreachable":
      return "Couldn't reach your node. Check that it is running, then try again.";
    case "unknown":
      return null;
  }
}

// src/invitations/justJoined.ts
var KEY = "calimero:justJoinedNamespaces";
function read() {
  try {
    if (typeof sessionStorage === "undefined") return /* @__PURE__ */ new Set();
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return /* @__PURE__ */ new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v) => typeof v === "string")) : /* @__PURE__ */ new Set();
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
var listeners2 = /* @__PURE__ */ new Set();
function notify() {
  for (const listener of [...listeners2]) {
    try {
      listener();
    } catch {
    }
  }
}
function subscribeJustJoined(listener) {
  listeners2.add(listener);
  return () => {
    listeners2.delete(listener);
  };
}
function write(set) {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
  }
}
function markNamespaceJustJoined(namespaceId) {
  if (!namespaceId) return;
  const set = read();
  if (set.has(namespaceId)) return;
  set.add(namespaceId);
  write(set);
  notify();
}
function clearNamespaceJustJoined(namespaceId) {
  const set = read();
  if (!set.delete(namespaceId)) return;
  write(set);
  notify();
}
function isNamespaceJustJoined(namespaceId) {
  if (!namespaceId) return false;
  return read().has(namespaceId);
}
function useInviteRedemption({
  parse,
  redeemer,
  redeem,
  confirm = true,
  onJoined,
  enabled = true
}) {
  const [state, setState] = useState({ stage: "idle" });
  const [token, setToken] = useState(null);
  const [parsed, setParsed] = useState(null);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const redeemerRef = useRef(redeemer);
  redeemerRef.current = redeemer;
  const redeemRef = useRef(redeem);
  redeemRef.current = redeem;
  const onJoinedRef = useRef(onJoined);
  onJoinedRef.current = onJoined;
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const attempted = useRef(/* @__PURE__ */ new Set());
  const pending = useRef(null);
  const parsedRef = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const perform = useCallback(
    async (captured, invitation) => {
      if (alive.current)
        setState({ stage: "joining", teamName: invitation.teamName });
      const outcome = await runRedeem(
        invitation,
        redeemRef.current,
        redeemerRef.current
      );
      if (!shouldRetain(outcome)) captured.resolve();
      if (outcome.status === "joined" || outcome.status === "already-member") {
        markNamespaceJustJoined(outcome.namespaceId);
        onJoinedRef.current?.(outcome.namespaceId, outcome.teamName);
      }
      if (!alive.current) return;
      setState(
        outcome.status === "failed" ? {
          stage: "failed",
          message: outcome.message,
          reason: outcome.reason,
          retryable: outcome.retryable
        } : {
          stage: outcome.status,
          namespaceId: outcome.namespaceId,
          teamName: outcome.teamName
        }
      );
    },
    []
  );
  const begin = useCallback(
    (captured) => {
      let invitation = null;
      try {
        invitation = parseRef.current(captured.token, captured.params);
      } catch {
        invitation = null;
      }
      if (!invitation?.namespaceId) {
        captured.resolve();
        if (alive.current) {
          setState({
            stage: "failed",
            message: "That invitation could not be read.",
            reason: "invalid",
            retryable: false
          });
        }
        return;
      }
      parsedRef.current = invitation;
      if (alive.current) setParsed(invitation);
      if (confirmRef.current) {
        if (alive.current) {
          setState({
            stage: "awaiting-confirmation",
            teamName: invitation.teamName
          });
        }
        return;
      }
      void perform(captured, invitation);
    },
    [perform]
  );
  useEffect(() => {
    if (!enabled) return;
    return onInvitation((captured) => {
      pending.current = captured;
      setToken(captured.token);
      if (attempted.current.has(captured.token)) return;
      if (!captured.autoJoin && !confirmRef.current) return;
      attempted.current.add(captured.token);
      begin(captured);
    });
  }, [enabled, begin]);
  const accept = useCallback(() => {
    const captured = pending.current;
    const invitation = parsedRef.current;
    if (!captured || !invitation) return;
    void perform(captured, invitation);
  }, [perform]);
  const decline = useCallback(() => {
    pending.current?.resolve();
    setState({ stage: "idle" });
  }, []);
  const retry = useCallback(() => {
    const captured = pending.current;
    if (!captured) return;
    attempted.current.add(captured.token);
    const invitation = parsedRef.current;
    if (invitation) void perform(captured, invitation);
    else begin(captured);
  }, [begin, perform]);
  const dismiss = useCallback(() => setState({ stage: "idle" }), []);
  return { state, token, parsed, accept, decline, retry, dismiss };
}
async function runRedeem(invitation, redeem, redeemer) {
  try {
    if (redeem) return await redeem(invitation);
    if (redeemer) return await redeemInvitation(invitation, redeemer);
    return {
      status: "failed",
      namespaceId: invitation.namespaceId,
      message: "This app cannot redeem invitations: no redeemer is configured.",
      reason: "unknown",
      retryable: false
    };
  } catch (err) {
    return {
      status: "failed",
      namespaceId: invitation.namespaceId,
      message: err instanceof Error ? err.message : String(err),
      reason: "unknown",
      retryable: true
    };
  }
}
var JOIN_SYNC_WATCHDOG_MS = 3e4;
var JOIN_SYNC_MAX_MS = 12e4;
var JOIN_SYNC_POLL_MS = 2e3;
function useJoinSync({
  namespaceId,
  settled,
  active
}) {
  const [, storeChanged] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const unsubscribe = subscribeJustJoined(storeChanged);
    storeChanged();
    return unsubscribe;
  }, []);
  const flagged = isNamespaceJustJoined(namespaceId);
  const firstSeen = useRef(/* @__PURE__ */ new Map());
  if (namespaceId && flagged && !firstSeen.current.has(namespaceId)) {
    firstSeen.current.set(namespaceId, Date.now());
  } else if (namespaceId && !flagged) {
    firstSeen.current.delete(namespaceId);
  }
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!namespaceId || !settled || !isNamespaceJustJoined(namespaceId)) return;
    clearNamespaceJustJoined(namespaceId);
  });
  useEffect(() => {
    if (!namespaceId || !flagged || settled) return;
    const since = firstSeen.current.get(namespaceId) ?? Date.now();
    let timer;
    const check = () => {
      const elapsed = Date.now() - since;
      const giveUp = elapsed >= JOIN_SYNC_MAX_MS || elapsed >= JOIN_SYNC_WATCHDOG_MS && !activeRef.current;
      if (giveUp) {
        clearNamespaceJustJoined(namespaceId);
        return;
      }
      timer = setTimeout(check, JOIN_SYNC_POLL_MS);
    };
    timer = setTimeout(check, JOIN_SYNC_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [namespaceId, flagged, settled]);
  return {
    isSyncing: flagged && !settled,
    dismiss: () => {
      if (!namespaceId) return;
      clearNamespaceJustJoined(namespaceId);
    }
  };
}
var INVITATION_READY_MS = 1200;
function useJustJoined(namespaceId) {
  return useSyncExternalStore(
    subscribeJustJoined,
    () => isNamespaceJustJoined(namespaceId),
    () => false
  );
}
function InvitationDialog({
  redemption,
  noun = "team",
  appName,
  synced,
  detail,
  status
}) {
  const { state, accept, decline, retry, dismiss } = redemption;
  const joinedId = state.stage === "joined" ? state.namespaceId : null;
  const [backgroundId, setBackgroundId] = useState(null);
  useEffect(() => {
    if (joinedId) setBackgroundId(joinedId);
  }, [joinedId]);
  const waitingId = joinedId ?? backgroundId;
  const flagged = useJustJoined(waitingId);
  const stillSyncing = joinedId !== null && flagged;
  useEffect(() => {
    if (!joinedId && backgroundId && !flagged) setBackgroundId(null);
  }, [joinedId, backgroundId, flagged]);
  useEffect(() => {
    if (waitingId && flagged && synced) clearNamespaceJustJoined(waitingId);
  }, [waitingId, flagged, synced]);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!waitingId || !flagged) return;
    const slowTimer = setTimeout(() => setSlow(true), JOIN_SYNC_WATCHDOG_MS);
    const ceiling = setTimeout(
      () => clearNamespaceJustJoined(waitingId),
      JOIN_SYNC_MAX_MS
    );
    return () => {
      clearTimeout(slowTimer);
      clearTimeout(ceiling);
    };
  }, [waitingId, flagged]);
  const stage = state.stage === "idle" ? null : state.stage === "joined" ? stillSyncing ? "syncing" : "ready" : state.stage;
  useEffect(() => {
    if (stage !== "ready") return;
    const t = setTimeout(dismiss, INVITATION_READY_MS);
    return () => clearTimeout(t);
  }, [stage, dismiss]);
  const titleId = useId();
  const bodyId = useId();
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);
  const primaryRef = useRef(null);
  const open = stage !== null;
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!open || !overlay || typeof MutationObserver === "undefined") return;
    const made = /* @__PURE__ */ new Set();
    const shut = (el) => {
      if (el === overlay || el.hasAttribute("inert")) return;
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return;
      el.setAttribute("inert", "");
      made.add(el);
    };
    Array.from(document.body.children).forEach(shut);
    const observer = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach((n) => n instanceof Element && shut(n));
    });
    observer.observe(document.body, { childList: true });
    return () => {
      observer.disconnect();
      made.forEach((el) => el.removeAttribute("inert"));
    };
  }, [open]);
  useEffect(() => {
    if (!stage) return;
    (primaryRef.current ?? dialogRef.current)?.focus();
  }, [stage]);
  const close = useCallback(() => {
    if (stage === "awaiting-confirmation") decline();
    else if (stage && stage !== "joining" && stage !== "syncing") dismiss();
  }, [stage, decline, dismiss]);
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  if (!stage || typeof document === "undefined") return null;
  const teamName = "teamName" in state ? state.teamName : void 0;
  const named = teamName ? `\u201C${teamName}\u201D` : `this ${noun}`;
  const busy = stage === "joining" || stage === "syncing";
  let icon = "invite";
  let title = "";
  let body = null;
  if (stage === "awaiting-confirmation") {
    title = teamName ? `Join \u201C${teamName}\u201D?` : `Join this ${noun}?`;
    body = detail ?? `You have been invited. Joining makes this device a member, and the ${noun}'s data syncs to it from the other members.`;
  } else if (stage === "joining") {
    icon = "spinner";
    title = `Joining ${named}\u2026`;
    body = status || "Asking a member to let you in. With few members online this can take up to a minute.";
  } else if (stage === "syncing") {
    icon = "spinner";
    title = `Syncing ${named}\u2026`;
    body = slow ? `Still waiting on the other members. You can carry on; the ${noun} fills in as its data arrives.` : `You're in. Getting the ${noun}'s data from the other members.`;
  } else if (stage === "ready") {
    icon = "done";
    title = `You're in ${named}`;
  } else if (stage === "already-member") {
    icon = "done";
    title = `You're already in ${named}`;
  } else {
    icon = "error";
    title = "Couldn't join";
    body = state.stage === "failed" ? describeInviteFailure(state.reason, noun) ?? state.message : null;
  }
  const retryable = state.stage === "failed" && state.retryable;
  return createPortal(
    /* @__PURE__ */ jsx(
      "div",
      {
        ref: overlayRef,
        className: "mero-invite-overlay",
        onMouseDown: (event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          close();
        },
        children: /* @__PURE__ */ jsxs(
          "div",
          {
            ref: dialogRef,
            className: "mero-invite-dialog",
            role: "dialog",
            "aria-modal": "true",
            "aria-labelledby": titleId,
            "aria-describedby": body ? bodyId : void 0,
            "aria-busy": busy,
            tabIndex: -1,
            "data-testid": "invite-prompt",
            "data-stage": stage,
            onKeyDown,
            children: [
              appName ? /* @__PURE__ */ jsx("p", { className: "mero-invite-app", children: appName }) : null,
              /* @__PURE__ */ jsxs("div", { className: "mero-invite-head", children: [
                /* @__PURE__ */ jsx(InviteIcon, { kind: icon }),
                /* @__PURE__ */ jsx("h2", { id: titleId, className: "mero-invite-title", children: title })
              ] }),
              body ? /* @__PURE__ */ jsx(
                "p",
                {
                  id: bodyId,
                  className: stage === "failed" ? "mero-invite-body mero-invite-body-error" : "mero-invite-body",
                  role: stage === "failed" ? "alert" : void 0,
                  "data-testid": stage === "failed" ? "invite-error" : void 0,
                  children: body
                }
              ) : null,
              stage === "syncing" || stage === "joining" ? /* @__PURE__ */ jsx("div", { className: "mero-invite-progress", "aria-hidden": "true", children: /* @__PURE__ */ jsx("span", { className: "mero-invite-progress-bar" }) }) : null,
              /* @__PURE__ */ jsxs("div", { className: "mero-invite-actions", children: [
                stage === "awaiting-confirmation" ? /* @__PURE__ */ jsxs(Fragment, { children: [
                  /* @__PURE__ */ jsx(
                    "button",
                    {
                      type: "button",
                      className: "mero-invite-button mero-invite-secondary",
                      onClick: decline,
                      "data-testid": "invite-decline",
                      children: "Not now"
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "button",
                    {
                      ref: primaryRef,
                      type: "button",
                      className: "mero-invite-button mero-invite-primary",
                      onClick: accept,
                      "data-testid": "invite-accept",
                      children: "Join"
                    }
                  )
                ] }) : null,
                stage === "syncing" && slow ? /* @__PURE__ */ jsx(
                  "button",
                  {
                    ref: primaryRef,
                    type: "button",
                    className: "mero-invite-button mero-invite-secondary",
                    onClick: dismiss,
                    "data-testid": "invite-continue",
                    children: "Continue in background"
                  }
                ) : null,
                stage === "ready" || stage === "already-member" ? /* @__PURE__ */ jsx(
                  "button",
                  {
                    ref: primaryRef,
                    type: "button",
                    className: "mero-invite-button mero-invite-primary",
                    onClick: dismiss,
                    "data-testid": "invite-done",
                    children: "Done"
                  }
                ) : null,
                stage === "failed" ? /* @__PURE__ */ jsxs(Fragment, { children: [
                  /* @__PURE__ */ jsx(
                    "button",
                    {
                      ref: retryable ? void 0 : primaryRef,
                      type: "button",
                      className: "mero-invite-button mero-invite-secondary",
                      onClick: dismiss,
                      "data-testid": "invite-decline",
                      children: "Close"
                    }
                  ),
                  retryable ? /* @__PURE__ */ jsx(
                    "button",
                    {
                      ref: primaryRef,
                      type: "button",
                      className: "mero-invite-button mero-invite-primary",
                      onClick: retry,
                      "data-testid": "invite-retry",
                      children: "Try again"
                    }
                  ) : null
                ] }) : null
              ] })
            ]
          }
        )
      }
    ),
    document.body
  );
}
function InviteIcon({ kind }) {
  if (kind === "spinner") {
    return /* @__PURE__ */ jsx("span", { className: "mero-invite-icon mero-invite-spinner", "aria-hidden": "true" });
  }
  const path = kind === "done" ? "M5 12.5l4.5 4.5L19 7.5" : kind === "error" ? "M12 7v6m0 4h.01" : "M4 7l8 6 8-6M5 6h14a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z";
  return /* @__PURE__ */ jsx("span", { className: `mero-invite-icon mero-invite-icon-${kind}`, "aria-hidden": "true", children: /* @__PURE__ */ jsx("svg", { viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: /* @__PURE__ */ jsx("path", { d: path }) }) });
}
function JoinSyncBanner({
  show,
  what = "data",
  onDismiss,
  className,
  style,
  children
}) {
  if (!show) return null;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      role: "status",
      "aria-live": "polite",
      className,
      style: {
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        padding: "0.625rem 0.875rem",
        borderRadius: "0.5rem",
        border: "1px solid var(--join-sync-border, rgba(127,127,127,0.28))",
        background: "var(--join-sync-bg, rgba(127,127,127,0.08))",
        color: "var(--join-sync-fg, inherit)",
        font: "inherit",
        fontSize: "0.875rem",
        lineHeight: 1.4,
        ...style
      },
      children: [
        /* @__PURE__ */ jsx(Spinner, {}),
        /* @__PURE__ */ jsx("span", { style: { flex: 1 }, children: children ?? /* @__PURE__ */ jsxs(Fragment, { children: [
          "Joined. Syncing ",
          what,
          " from peers\u2026",
          " ",
          /* @__PURE__ */ jsx("span", { style: { opacity: 0.75 }, children: "This can take a moment on a cold connection." })
        ] }) }),
        onDismiss && /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: onDismiss,
            style: {
              font: "inherit",
              fontSize: "0.8125rem",
              background: "none",
              border: "none",
              padding: 0,
              color: "inherit",
              opacity: 0.75,
              textDecoration: "underline",
              cursor: "pointer"
            },
            children: "Show anyway"
          }
        )
      ]
    }
  );
}
function Spinner() {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      width: "14",
      height: "14",
      viewBox: "0 0 16 16",
      "aria-hidden": "true",
      style: { flexShrink: 0, opacity: 0.85 },
      children: [
        /* @__PURE__ */ jsx(
          "circle",
          {
            cx: "8",
            cy: "8",
            r: "6.5",
            fill: "none",
            stroke: "currentColor",
            strokeOpacity: "0.25",
            strokeWidth: "2"
          }
        ),
        /* @__PURE__ */ jsx(
          "path",
          {
            d: "M8 1.5A6.5 6.5 0 0 1 14.5 8",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "2",
            strokeLinecap: "round",
            children: /* @__PURE__ */ jsx(
              "animateTransform",
              {
                attributeName: "transform",
                type: "rotate",
                from: "0 8 8",
                to: "360 8 8",
                dur: "0.8s",
                repeatCount: "indefinite"
              }
            )
          }
        )
      ]
    }
  );
}
function usePendingInvitation() {
  return useSyncExternalStore(subscribeInvitation, peekInvitation, () => null);
}
function InvitationGate({
  children,
  parse,
  noun = "team",
  appName,
  detail,
  connectButtonProps
}) {
  const session = useContext(MeroContext);
  const pending = usePendingInvitation();
  const parsed = useMemo(() => {
    if (!pending || !parse) return null;
    try {
      const result = parse(pending.token, pending.params);
      return result?.namespaceId ? result : void 0;
    } catch {
      return void 0;
    }
  }, [pending, parse]);
  const state = !pending || !session || session.isAuthenticated ? null : session.isLoading ? "checking" : parsed === void 0 ? "invalid" : "invited";
  if (!state) return children === void 0 ? null : /* @__PURE__ */ jsx(Fragment, { children });
  const page = /* @__PURE__ */ jsx(
    InvitationScreen,
    {
      state,
      teamName: parsed?.teamName,
      noun,
      appName,
      detail,
      connectButtonProps,
      onDecline: () => pending?.resolve()
    }
  );
  if (children !== void 0 || typeof document === "undefined") return page;
  return createPortal(page, document.body);
}
function InvitationScreen({
  state,
  teamName,
  noun,
  appName,
  detail,
  connectButtonProps,
  onDecline
}) {
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef(null);
  const loginRef = useRef(null);
  const continueRef = useRef(null);
  useEffect(() => {
    if (state === "checking") return;
    const target = state === "invited" ? loginRef.current?.querySelector("button") : continueRef.current;
    (target ?? cardRef.current)?.focus();
  }, [state]);
  const onKeyDown = (event) => {
    if (event.key !== "Tab" || !cardRef.current) return;
    const focusable = cardRef.current.querySelectorAll(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  if (state === "checking") {
    return /* @__PURE__ */ jsx(
      "div",
      {
        className: "mero-invite-landing",
        role: "status",
        "aria-busy": "true",
        "aria-label": "Checking your session",
        "data-testid": "invite-landing",
        "data-state": "checking",
        children: /* @__PURE__ */ jsx("span", { className: "mero-invite-icon mero-invite-spinner", "aria-hidden": "true" })
      }
    );
  }
  const invalid = state === "invalid";
  const title = invalid ? "This invitation can't be read" : teamName ? `You're invited to join \u201C${teamName}\u201D` : `You're invited to join a ${noun}`;
  const where = appName ? ` in ${appName}` : "";
  const body = invalid ? "The link may have been cut short when it was shared. Ask whoever sent it for a new one." : `Someone sent you a link to join this ${noun}${where}. Log in to accept it; you'll be asked to confirm before you join.`;
  return /* @__PURE__ */ jsx("div", { className: "mero-invite-landing", children: /* @__PURE__ */ jsxs(
    "div",
    {
      ref: cardRef,
      className: "mero-invite-dialog mero-invite-landing-card",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": titleId,
      "aria-describedby": bodyId,
      tabIndex: -1,
      "data-testid": "invite-landing",
      "data-state": state,
      onKeyDown,
      children: [
        appName ? /* @__PURE__ */ jsx("p", { className: "mero-invite-app", children: appName }) : null,
        /* @__PURE__ */ jsxs("div", { className: "mero-invite-head", children: [
          /* @__PURE__ */ jsx(InviteIcon2, { error: invalid }),
          /* @__PURE__ */ jsx("h1", { id: titleId, className: "mero-invite-title", children: title })
        ] }),
        /* @__PURE__ */ jsx("p", { id: bodyId, className: "mero-invite-body", children: body }),
        detail && !invalid ? /* @__PURE__ */ jsx("p", { className: "mero-invite-body", children: detail }) : null,
        /* @__PURE__ */ jsx("div", { className: "mero-invite-actions", children: invalid ? /* @__PURE__ */ jsx(
          "button",
          {
            ref: continueRef,
            type: "button",
            className: "mero-invite-button mero-invite-primary",
            onClick: onDecline,
            "data-testid": "invite-landing-decline",
            children: "Continue"
          }
        ) : /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "mero-invite-button mero-invite-secondary",
              onClick: onDecline,
              "data-testid": "invite-landing-decline",
              children: "Not now"
            }
          ),
          /* @__PURE__ */ jsx(
            "div",
            {
              ref: loginRef,
              className: "mero-invite-landing-login",
              "data-testid": "invite-landing-login",
              children: /* @__PURE__ */ jsx(ConnectButton, { ...connectButtonProps, label: "Log in to join" })
            }
          )
        ] }) })
      ]
    }
  ) });
}
function InviteIcon2({ error }) {
  const path = error ? "M12 7v6m0 4h.01" : "M4 7l8 6 8-6M5 6h14a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z";
  return /* @__PURE__ */ jsx(
    "span",
    {
      className: error ? "mero-invite-icon mero-invite-icon-error" : "mero-invite-icon",
      "aria-hidden": "true",
      children: /* @__PURE__ */ jsx("svg", { viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: /* @__PURE__ */ jsx("path", { d: path }) })
    }
  );
}
function statusOf(err) {
  if (!err || typeof err !== "object") return void 0;
  const e = err;
  for (const c of [e.status, e.response?.status, e.statusCode]) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  return void 0;
}
var STEP_LABEL = {
  "no-credential": "No enrolled account",
  "admitters-lookup": "Admitters lookup failed",
  "no-nodes": "No hosted node serves this namespace",
  "not-invited": "This invitation names none of the serving nodes",
  "invited-unreachable": "The invited admitter cannot take a join right now",
  "no-relay-url": "The invited admitter has no address yet",
  sign: "The join could not be signed",
  admit: "The admitter refused the join"
};
function accountJoinIsFinal(failure) {
  if (failure.step === "admit") return failure.status === 400 || failure.status === 403;
  return failure.step === "not-invited" || failure.step === "sign";
}
function isFinalInvitationError(message) {
  if (!message) return false;
  const m = message.toLowerCase();
  return [
    "invitation expired",
    "expired invitation",
    "invalid invitation",
    "invitation is invalid",
    "malformed invitation",
    "malformed payload",
    "invalid signature",
    "signature verification failed",
    "not admin",
    "revoked",
    "already a member"
  ].some((t) => m.includes(t));
}
function useJoinInvitation() {
  const { mero, isDelegated } = useMero();
  const { credential, bootstrap } = useDelegatedBootstrap();
  const [joining, setJoining] = useState(false);
  const joinInvitation = useCallback(
    async (input) => {
      setJoining(true);
      try {
        const asAccount = isDelegated || credential !== null && mero === null;
        if (asAccount) {
          const outcome = await bootstrap({
            namespaceId: input.namespaceId,
            invitation: input.invitation,
            contextId: input.contextId
          });
          if (outcome.ok) return { ok: true };
          return {
            ok: false,
            step: outcome.step,
            reason: `${STEP_LABEL[outcome.step]}. ${outcome.reason}`,
            final: accountJoinIsFinal(outcome),
            ...outcome.status !== void 0 ? { status: outcome.status } : {}
          };
        }
        if (!mero) {
          return { ok: false, step: "node-join", reason: "Not connected to a node.", final: false };
        }
        await mero.admin.joinNamespace(input.namespaceId, { invitation: input.invitation });
        if (input.contextId) await mero.admin.joinContext(input.contextId);
        return { ok: true };
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        const status = statusOf(e);
        return {
          ok: false,
          step: "node-join",
          reason,
          final: isFinalInvitationError(reason),
          ...status !== void 0 ? { status } : {}
        };
      } finally {
        setJoining(false);
      }
    },
    [mero, isDelegated, credential, bootstrap]
  );
  const memberships = useCallback(async () => {
    const asAccount = isDelegated || credential !== null && mero === null;
    const ids = (list) => list.map((n) => n.namespaceId ?? n.groupId ?? n.id ?? "").filter(Boolean);
    if (asAccount) {
      const session = readDelegatedSession();
      return session ? ids(await listDelegatedNamespaces(session)) : [];
    }
    if (!mero) return [];
    return ids(await mero.admin.listNamespaces());
  }, [mero, isDelegated, credential]);
  const invitationRedeemer = useCallback(
    (input) => ({
      join: async () => {
        const outcome = await joinInvitation(input);
        if (!outcome.ok) {
          throw Object.assign(new Error(outcome.reason), outcome.status !== void 0 ? { status: outcome.status } : {});
        }
      },
      memberships
    }),
    [joinInvitation, memberships]
  );
  return { joinInvitation, joining, memberships, invitationRedeemer };
}

export { AccountSignInPanel, AppMode, CalimeroLogo, ConnectButton, ConnectButtonAccount, ConnectionType, DEFAULT_MIGRATION_POLL_INTERVAL_MS, INVITATION_PARAM, INVITATION_READY_MS, InvitationDialog, InvitationGate, JOIN_ACTION, JOIN_SYNC_MAX_MS, JOIN_SYNC_POLL_MS, JOIN_SYNC_WATCHDOG_MS, JoinSyncBanner, LoginModal, MAX_AUTO_JOIN_ATTEMPTS, MERO_CSS_VARS, MeroContext, MeroProvider, MigrationAdminPanel, MigrationPendingBanner, buildInviteLink, clearAllStorage, clearApplicationId, clearContextId, clearContextIdentity, clearNamespaceJustJoined, clearNodeUrl, clearTokenNodeUrl, cssVar, defaultMeroTheme, describeInviteFailure, getApplicationId, getContextId, getContextIdentity, getNodeUrl, getPermissionsForMode, getTokenNodeUrl, invitationFromRaw, isDesktopWindow, isFinalInvitationError, isNamespaceJustJoined, isReturningFromWallet, localStorageTokenStorage, markNamespaceJustJoined, onInvitation, peekInvitation, primeInvitationCapture, resetInvitationCaptureForTests, resolveMeroTheme, setApplicationId, setContextId, setContextIdentity, setNodeUrl, setTokenNodeUrl, subscribeInvitation, subscribeJustJoined, themeToCssVars, urlWithoutInvitation, useAccountEnrolment, useAddGroupMembers, useAppVersion, useApplicationContexts, useBlobInfo, useBlobUrl, useContextDiscovery, useContextGroup, useContexts, useCreateContext, useCreateGroupInNamespace, useCreateNamespace, useCreateNamespaceInvitation, useCreatePrivateContext, useDefaultCapabilities, useDelegatedBootstrap, useDeleteContext, useDeleteGroup, useDeleteNamespace, useDetachContextFromGroup, useEphemeral, useExecute, useGroupAppVersion, useGroupCapabilities, useGroupContexts, useGroupInfo, useGroupInvitations, useGroupMembers, useGroupMetadata, useGroupUpgradeStatus, useInstallFromRegistry, useInviteRedemption, useJoinContext, useJoinGroup, useJoinInvitation, useJoinNamespace, useJoinSubgroupInheritance, useJoinSync, useLatestVersion, useMemberMetadata, useMero, useMigrationEvents, useMigrationStatus, useMyAuthoredMigration, useNamespace, useNamespaceGroups, useNamespaces, useNamespacesForApplication, useNodeIdentity, usePendingInvitation, useRedeemInvitation, useRemoveGroupMembers, useReparentGroup, useResyncContext, useRetryGroupUpgrade, useSetContextMetadata, useSetDefaultCapabilities, useSetGroupMetadata, useSetMemberMetadata, useSetSubgroupVisibility, useSetTeeAdmissionPolicy, useSubgroupVisibility, useSubgroups, useSubscription, useSyncGroup, useUpdateMemberRole, useUpgradeGroup, useUploadBlob };
