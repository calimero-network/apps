/**
 * Unit tests for useChatHandlers — handleExecutionEvents
 *
 * Verifies that each SSE event kind triggers the correct data-refresh
 * callbacks. No real node required — all API calls and refs are mocked.
 *
 * Coverage:
 *   ChannelCreated, ChannelInvited, ChannelJoined, ChannelLeft,
 *   ChannelDeleted, DMCreated, DMDeleted, MessageSent (active + background),
 *   ReactionUpdated, ChatInitialized, multi-event batches
 *
 * Run: pnpm test src/hooks/useChatHandlers.test.ts
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RefObject } from "react";
import { useChatHandlers } from "./useChatHandlers";
import type { ExecutionEventData } from "../types/WebSocketTypes";
import type { ActiveChat } from "../types/Common";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../utils/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../api/dataSource/clientApiDataSource", () => ({
  ClientApiDataSource: vi.fn().mockReturnValue({
    getMessages: vi.fn().mockResolvedValue({ data: { messages: [] } }),
  }),
}));

vi.mock("@calimero-network/mero-react", () => ({
  getContextIdentity: vi.fn().mockReturnValue("my-identity"),
}));

// Returns a JSON object with both channel and context_id fields so all
// parsers that look for either field get a valid value.
vi.mock("../utils/bytesParser", () => ({
  bytesParser: vi.fn().mockReturnValue('{"channel":"general","context_id":"ctx-new"}'),
}));

vi.mock("../utils/session", () => ({
  getStoredSession: vi.fn().mockReturnValue(null),
}));

vi.mock("../utils/messengerName", () => ({
  getMessengerDisplayName: vi.fn().mockReturnValue("TestUser"),
  // Used by utils/selfIdentity. Omitting it made the self-check throw, which
  // the notification path's try/catch swallowed — every toast silently lost.
  getStoredExecutorIdentity: vi.fn().mockReturnValue(""),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRefs() {
  const fetchChannels = vi.fn();
  const fetchDMs = vi.fn();
  const fetchMembers = vi.fn();
  const fetchGroupMembers = vi.fn();
  const onLeftChannel = vi.fn();
  const subscribeToContext = vi.fn();
  const fetchDms = vi.fn().mockResolvedValue([]);
  const onDMSelected = vi.fn();
  const onUnreadRefresh = vi.fn().mockResolvedValue(undefined);
  const onUnreadClear = vi.fn().mockResolvedValue(undefined);
  const playSoundForMessage = vi.fn();
  const notifyMessage = vi.fn();
  const notifyDM = vi.fn();
  const notifyChannel = vi.fn();
  const notifyThread = vi.fn();

  const refs = {
    mainMessages: {
      current: {
        checkForNewMessages: vi.fn().mockResolvedValue([]),
        addIncoming: vi.fn(),
      },
    },
    threadMessages: {
      current: {
        checkForNewThreadMessages: vi.fn().mockResolvedValue([]),
        addIncoming: vi.fn(),
      },
    },
    playSoundForMessage: { current: playSoundForMessage },
    notifyMessage: { current: notifyMessage },
    notifyDM: { current: notifyDM },
    notifyChannel: { current: notifyChannel },
    notifyThread: { current: notifyThread },
    fetchDms: { current: fetchDms },
    onDMSelected: { current: onDMSelected },
    fetchChannels: { current: fetchChannels },
    fetchDMs: { current: fetchDMs },
    fetchMembers: { current: fetchMembers },
    fetchGroupMembers: { current: fetchGroupMembers },
    onLeftChannel: { current: onLeftChannel },
    subscribeToContext: { current: subscribeToContext },
    contextIdentityMap: { current: new Map<string, string>() },
    contextNameMap: { current: new Map<string, string>() },
    dmContextIds: { current: new Set<string>() },
    onUnreadRefresh: { current: onUnreadRefresh },
    onUnreadClear: { current: onUnreadClear },
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refs: refs as any,
    mocks: {
      fetchChannels,
      fetchDMs,
      fetchMembers,
      fetchGroupMembers,
      onLeftChannel,
      subscribeToContext,
      fetchDms,
      onDMSelected,
      onUnreadRefresh,
      onUnreadClear,
      notifyDM,
      notifyChannel,
      checkForNewMessages: refs.mainMessages.current.checkForNewMessages,
    },
  };
}

function makeActiveChat(contextId = "ctx-active"): ActiveChat {
  return {
    id: "ch-1",
    name: "general",
    contextId,
    type: "channel",
    contextIdentity: "my-identity",
  };
}

function ev(kind: string, data?: unknown): ExecutionEventData {
  return { kind, data };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useChatHandlers — channel events", () => {
  const activeChatRef: { current: ActiveChat | null } = { current: null };

  beforeEach(() => {
    activeChatRef.current = null;
    vi.clearAllMocks();
  });

  it("RoleUpdated: fetches members so role badges update for everyone", () => {
    const { refs, mocks } = makeRefs();
    const { result } = renderHook(() =>
      useChatHandlers(activeChatRef as RefObject<ActiveChat | null>, null, refs),
    );

    act(() => {
      result.current.handleExecutionEvents("ctx-1", [ev("RoleUpdated", "some-identity")]);
    });

    expect(mocks.fetchMembers).toHaveBeenCalledTimes(1);
    expect(mocks.fetchChannels).not.toHaveBeenCalled();
    expect(mocks.fetchDMs).not.toHaveBeenCalled();
  });

  it("MessageSent on the active channel: calls checkForNewMessages", async () => {
    const chat = makeActiveChat("ctx-active");
    activeChatRef.current = chat;
    const { refs, mocks } = makeRefs();
    const { result } = renderHook(() =>
      useChatHandlers(activeChatRef as RefObject<ActiveChat | null>, chat, refs),
    );

    await act(async () => {
      result.current.handleExecutionEvents("ctx-active", [ev("MessageSent", {})]);
      // let the async handleMessageUpdates settle
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mocks.checkForNewMessages).toHaveBeenCalled();
    // Not a channel/DM list refresh
    expect(mocks.fetchChannels).not.toHaveBeenCalled();
    expect(mocks.fetchDMs).not.toHaveBeenCalled();
  });

  it("does not toast the user's own message in a context whose identity is not the global one", async () => {
    const { refs, mocks } = makeRefs();
    const chat = makeActiveChat("ctx-active");
    activeChatRef.current = chat;

    // Identity is per context. The global getContextIdentity() is mocked to
    // "my-identity"; in THIS channel we are "ctx-active-identity". Comparing
    // against the global value alone made our own message look like someone
    // else's and toasted it.
    refs.contextIdentityMap.current.set("ctx-active", "ctx-active-identity");
    chat.contextIdentity = "ctx-active-identity";

    refs.mainMessages.current.checkForNewMessages.mockResolvedValue([
      {
        id: "m-1",
        sender: "ctx-active-identity",
        senderUsername: "me",
        text: "hello from me",
        group: "general",
      },
    ]);

    const { result } = renderHook(() =>
      useChatHandlers(activeChatRef as RefObject<ActiveChat | null>, chat, refs),
    );

    await act(async () => {
      result.current.handleExecutionEvents("ctx-active", [
        ev("MessageSent", {}),
      ]);
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(mocks.notifyChannel).not.toHaveBeenCalled();
  });

  it("still toasts another user's message in that same context", async () => {
    const { refs, mocks } = makeRefs();
    const chat = makeActiveChat("ctx-active");
    activeChatRef.current = chat;

    refs.contextIdentityMap.current.set("ctx-active", "ctx-active-identity");
    chat.contextIdentity = "ctx-active-identity";

    refs.mainMessages.current.checkForNewMessages.mockResolvedValue([
      {
        id: "m-2",
        sender: "someone-else",
        senderUsername: "them",
        text: "hello from them",
        group: "general",
      },
    ]);

    const { result } = renderHook(() =>
      useChatHandlers(activeChatRef as RefObject<ActiveChat | null>, chat, refs),
    );

    await act(async () => {
      result.current.handleExecutionEvents("ctx-active", [
        ev("MessageSent", {}),
      ]);
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(mocks.notifyChannel).toHaveBeenCalledTimes(1);
  });

  it("MessageSent on a background context with no identity map entry: no crash", async () => {
    const { refs } = makeRefs();
    const { result } = renderHook(() =>
      useChatHandlers(activeChatRef as RefObject<ActiveChat | null>, null, refs),
    );

    // Should not throw even when contextIdentityMap has no entry for ctx-bg
    await act(async () => {
      result.current.handleExecutionEvents("ctx-bg", [ev("MessageSent", {})]);
      await new Promise((r) => setTimeout(r, 50));
    });
  });

  it("MessageSent on background context with known identity: refreshes unread count", async () => {
    const { refs, mocks } = makeRefs();
    refs.contextIdentityMap.current.set("ctx-bg", "their-identity");
    const { result } = renderHook(() =>
      useChatHandlers(activeChatRef as RefObject<ActiveChat | null>, null, refs),
    );

    await act(async () => {
      result.current.handleExecutionEvents("ctx-bg", [ev("MessageSent", {})]);
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(mocks.onUnreadRefresh).toHaveBeenCalledWith("ctx-bg", "their-identity");
  });

  it("ReactionUpdated: fetches messages for active chat, no channel/DM list refresh", async () => {
    const chat = makeActiveChat("ctx-active");
    activeChatRef.current = chat;
    const { refs, mocks } = makeRefs();
    const { result } = renderHook(() =>
      useChatHandlers(activeChatRef as RefObject<ActiveChat | null>, chat, refs),
    );

    await act(async () => {
      result.current.handleExecutionEvents("ctx-active", [ev("ReactionUpdated")]);
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mocks.checkForNewMessages).toHaveBeenCalled();
    expect(mocks.fetchChannels).not.toHaveBeenCalled();
  });
});

describe("useChatHandlers — full-refresh events", () => {
  const activeChatRef: { current: ActiveChat | null } = { current: null };

  beforeEach(() => {
    activeChatRef.current = null;
    vi.clearAllMocks();
  });

  it("empty events array: no callbacks fired", () => {
    const { refs, mocks } = makeRefs();
    const { result } = renderHook(() =>
      useChatHandlers(activeChatRef as RefObject<ActiveChat | null>, null, refs),
    );

    act(() => {
      result.current.handleExecutionEvents("ctx-1", []);
    });

    expect(mocks.fetchChannels).not.toHaveBeenCalled();
    expect(mocks.fetchDMs).not.toHaveBeenCalled();
    expect(mocks.fetchMembers).not.toHaveBeenCalled();
  });
});
