import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCallController, type CallController } from "../hooks/useCall";
import MiniCall from "./MiniCall";

const CallCtx = createContext<CallController | null>(null);

/** Access the live call. Available anywhere under CallProvider. */
export function useCall(): CallController {
  const ctx = useContext(CallCtx);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}

/**
 * Holds the call above the router so it survives navigation — the call keeps
 * running when you leave the /call screen, shown as a floating mini-call. This
 * is what makes minimize (browse the lobby mid-call) possible.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const call = useCallController();
  const location = useLocation();
  const navigate = useNavigate();
  const wasActive = useRef(false);

  // When the call ends (leave / host ended / last one out) while we're on the
  // full call screen, fall back to the lobby.
  useEffect(() => {
    if (wasActive.current && !call.active && location.pathname === "/call") {
      navigate("/lobby");
    }
    wasActive.current = call.active;
  }, [call.active, location.pathname, navigate]);

  const onCallScreen = location.pathname === "/call";

  return (
    <CallCtx.Provider value={call}>
      {children}
      {call.active && !onCallScreen && <MiniCall onExpand={() => navigate("/call")} />}
    </CallCtx.Provider>
  );
}
