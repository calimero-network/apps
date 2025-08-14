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