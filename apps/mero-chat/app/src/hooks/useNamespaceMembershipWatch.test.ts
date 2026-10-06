import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolve = vi.fn();
vi.mock("../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    resolveCurrentMemberIdentity = resolve;
  },
}));
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

const member = { data: { memberIdentity: "me" }, error: null };
const notFound = { data: null, error: { code: 404, message: "group 'ab12' not found" } };
const noRow = {
  data: null,
  error: { code: 404, message: "Could not resolve identity for this namespace." },
};
const refused = { data: null, error: { code: 403, message: "node is not a member of group 'ab12'" } };

describe("classifyMembershipCheck", () => {
  it("reads a resolved row as a member", () => {
    expect(classifyMembershipCheck(member)).toBe("member");
  });

  // The node has not applied the namespace yet: nothing about the caller.
  it("never reads a group this node does not hold as a removal", () => {
    expect(classifyMembershipCheck(notFound)).toBe("unknown");
  });

  it("reads a missing row and a non-member refusal as removed", () => {
    expect(classifyMembershipCheck(noRow)).toBe("removed");
    expect(classifyMembershipCheck(refused)).toBe("removed");
  });

  it("reads any other failure as unknown", () => {
    expect(classifyMembershipCheck({ data: null, error: { code: 500, message: "boom" } })).toBe("unknown");
    expect(
      classifyMembershipCheck({ data: null, error: { code: 403, message: "Token does not carry the permissions" } }),
    ).toBe("unknown");
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
