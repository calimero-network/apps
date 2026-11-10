import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolve = vi.fn();
vi.mock("../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    listMembers = resolve;
  },
}));
vi.mock("../api/calimero", () => ({ getAccountId: () => "me" }));
vi.mock("../constants/config", () => ({
  getGroupId: () => "ns-1",
  clearWorkspaceSelection: vi.fn(),
}));
vi.mock("../utils/session", () => ({ clearNamespaceReady: vi.fn() }));
const addToast = vi.fn();
vi.mock("../contexts/ToastContext", () => ({ useToast: () => ({ addToast }) }));

import {
  classifyMembershipCheck,
  REMOVAL_CONFIRMATIONS,
  useNamespaceMembershipWatch,
} from "./useNamespaceMembershipWatch";

const member = { data: { members: [{ identity: "other" }, { identity: "me" }] }, error: null };
const notFound = { data: null, error: { code: 404, message: "group 'ab12' not found" } };
// Taken out of Chat (its app team) or out of the org: the list loads without the caller.
const noRow = { data: { members: [{ identity: "other" }] }, error: null };
const gone = { data: null, error: { code: 404, message: "Not found: app 'ab12'" } };
const refused = { data: null, error: { code: 403, message: "node is not a member of group 'ab12'" } };

describe("classifyMembershipCheck", () => {
  it("reads a list holding the caller as a member", () => {
    expect(classifyMembershipCheck(member, "me")).toBe("member");
  });

  // The node has not applied the namespace yet: nothing about the caller.
  it("never reads a group this node does not hold as a removal", () => {
    expect(classifyMembershipCheck(notFound, "me")).toBe("unknown");
  });

  it("reads a list without the caller, a 404 and a non-member refusal as removed", () => {
    expect(classifyMembershipCheck(noRow, "me")).toBe("removed");
    expect(classifyMembershipCheck(gone, "me")).toBe("removed");
    expect(classifyMembershipCheck(refused, "me")).toBe("removed");
  });

  it("reads any other failure, or no signed-in account, as unknown", () => {
    expect(classifyMembershipCheck({ data: null, error: { code: 500, message: "boom" } }, "me")).toBe("unknown");
    expect(
      classifyMembershipCheck(
        { data: null, error: { code: 403, message: "Token does not carry the permissions" } },
        "me",
      ),
    ).toBe("unknown");
    expect(classifyMembershipCheck(noRow, "")).toBe("unknown");
  });
});

describe("useNamespaceMembershipWatch", () => {
  const replace = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    resolve.mockReset();
    addToast.mockReset();
    replace.mockReset();
    Object.defineProperty(window, "location", { value: { replace }, configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  const poll = () => act(async () => void (await vi.advanceTimersByTimeAsync(30_000)));

  it(`bounces only after ${REMOVAL_CONFIRMATIONS} removal signals in a row`, async () => {
    resolve.mockResolvedValueOnce(member).mockResolvedValue(noRow);
    renderHook(() => useNamespaceMembershipWatch());
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    await poll();
    expect(replace).not.toHaveBeenCalled();
    await poll();
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it("never bounces while the node does not hold the namespace", async () => {
    resolve.mockResolvedValueOnce(member).mockResolvedValue(notFound);
    renderHook(() => useNamespaceMembershipWatch());
    for (let i = 0; i < 5; i++) await poll();
    expect(replace).not.toHaveBeenCalled();
  });

  it("starts the count over when a poll in between resolves", async () => {
    resolve
      .mockResolvedValueOnce(member)
      .mockResolvedValueOnce(noRow)
      .mockResolvedValueOnce(member)
      .mockResolvedValueOnce(noRow)
      .mockResolvedValue(member);
    renderHook(() => useNamespaceMembershipWatch());
    for (let i = 0; i < 5; i++) await poll();
    expect(replace).not.toHaveBeenCalled();
  });
});
