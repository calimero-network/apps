import { describe, expect, it, vi, beforeEach } from "vitest";

const { handlers, mockClear } = vi.hoisted(() => ({
  handlers: [] as Array<(intent: { params: Record<string, string>; resolve: () => void }) => void>,
  mockClear: vi.fn(),
}));

vi.mock("@calimero-network/mero-platform-react", () => ({
  useDeepLink: (h: (typeof handlers)[number]) => {
    handlers.push(h);
  },
}));
vi.mock("../utils/session", () => ({ clearNamespaceReady: mockClear }));

import { useInvitationHandoff } from "./useInvitationHandoff";

describe("useInvitationHandoff", () => {
  beforeEach(() => {
    handlers.length = 0;
    mockClear.mockReset();
    sessionStorage.clear();
  });

  it("hands an invitation that arrives inside a workspace to the workspace picker, unacknowledged", () => {
    const go = vi.fn();
    useInvitationHandoff(go);
    const resolve = vi.fn();
    handlers[0]({ params: { invitation: "abc" }, resolve });
    expect(mockClear).toHaveBeenCalled();
    expect(go).toHaveBeenCalledWith("/login");
    // Left in the pending store: the picker consumes it, as on a cold open.
    expect(resolve).not.toHaveBeenCalled();
  });

  it("hands each invitation off once per session, so a retained one cannot bounce forever", () => {
    // The picker keeps an invitation that failed transiently, to retry later.
    // Handing it off on every visit here would loop between the two pages.
    const go = vi.fn();
    useInvitationHandoff(go);
    handlers[0]({ params: { invitation: "abc" }, resolve: vi.fn() });
    handlers[0]({ params: { invitation: "abc" }, resolve: vi.fn() });
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("ignores intents that carry no invitation", () => {
    const go = vi.fn();
    useInvitationHandoff(go);
    handlers[0]({ params: {}, resolve: vi.fn() });
    expect(go).not.toHaveBeenCalled();
  });
});
