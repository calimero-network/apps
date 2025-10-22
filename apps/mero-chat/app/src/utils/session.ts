import type { ActiveChat } from "../types/Common";

export const updateSessionChat = (session: ActiveChat) => {
  localStorage.setItem("lastSession", JSON.stringify(session));
};

export const getStoredSession = (): ActiveChat | null => {
  try {
    const storedSession = localStorage.getItem("lastSession");
    if (storedSession) {
      const parsedSession = JSON.parse(storedSession);
      // Validate that the stored session has the required properties
      if (parsedSession && parsedSession.type && parsedSession.id && parsedSession.name) {
        return parsedSession as ActiveChat;
      }
    }
  } catch (error) {
    console.error("Error reading session from localStorage:", error);
  }
  return null;
};

export const clearStoredSession = () => {
  localStorage.removeItem("lastSession");
};

export const setDmContextId = (contextId: string) => {
  localStorage.setItem("dmContextId", contextId);
}

export const getDmContextId = () => {
  return localStorage.getItem("dmContextId");
}

export const clearDmContextId = () => {
  localStorage.removeItem("dmContextId");
}

// Session timeout tracking
const SESSION_TIMEOUT_KEY = "sessionLastActivity";
const SESSION_TIMEOUT_MS = 3600000; // 1 hour

export const updateSessionActivity = () => {
  localStorage.setItem(SESSION_TIMEOUT_KEY, Date.now().toString());
};

export const getSessionLastActivity = (): number | null => {
  try {
    const stored = localStorage.getItem(SESSION_TIMEOUT_KEY);
    return stored ? parseInt(stored, 10) : null;
  } catch (error) {
    console.error("Error reading session activity from localStorage:", error);
    return null;
  }
};

export const isSessionExpired = (): boolean => {
  const lastActivity = getSessionLastActivity();
  if (!lastActivity) return false; // No session data means not expired

  const now = Date.now();
  const timeSinceActivity = now - lastActivity;

  return timeSinceActivity >= SESSION_TIMEOUT_MS;
};

export const clearSessionActivity = () => {
  localStorage.removeItem(SESSION_TIMEOUT_KEY);
};
