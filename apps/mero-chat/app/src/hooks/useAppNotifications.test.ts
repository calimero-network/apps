import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAppNotifications } from "./useAppNotifications";

const mockAddToast = vi.fn();
const mockAddNotification = vi.fn();
const mockPlaySoundForMessage = vi.fn();
const mockPlaySound = vi.fn();

vi.mock("../contexts/ToastContext", () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock("@calimero-network/mero-ui", () => ({
  useNotifications: () => ({ addNotification: mockAddNotification }),
}));

vi.mock("./useNotificationSound", () => ({
  useNotificationSound: () => ({
    playSoundForMessage: mockPlaySoundForMessage,
    playSound: mockPlaySound,
    isEnabled: true,
  }),
}));

describe("useAppNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("notifyChannel shows sender in #channel format", () => {
    const { result } = renderHook(() => useAppNotifications());
    result.current.notifyChannel("msg1", "general", "Alice", "hello");
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Alice in #general" }),
    );
  });

  it("notifyDM shows 'New DM from' format", () => {
    const { result } = renderHook(() => useAppNotifications());
    result.current.notifyDM("msg2", "Bob", "hey there");
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New DM from Bob" }),
    );
  });

  it("notifyThread shows 'New reply from sender in #channel' format", () => {
    const { result } = renderHook(() => useAppNotifications());
    result.current.notifyThread("msg3", "general", "Carol", "thread reply text");
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New reply from Carol in #general" }),
    );
  });

  it("notifyThread truncates long text", () => {
    const { result } = renderHook(() => useAppNotifications());
    const longText = "a".repeat(150);
    result.current.notifyThread("msg4", "general", "Dave", longText);
    const call = mockAddToast.mock.calls[0][0];
    expect(call.message.length).toBeLessThanOrEqual(103); // 100 + "..."
  });

  it("notifyThread plays a sound", () => {
    const { result } = renderHook(() => useAppNotifications());
    result.current.notifyThread("msg5", "general", "Eve", "hi");
    expect(mockPlaySoundForMessage).toHaveBeenCalledWith("msg5", "message", false);
  });
});
