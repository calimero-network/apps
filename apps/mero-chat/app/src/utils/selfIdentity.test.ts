import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetContextIdentity,
  mockGetContextMemberIdentity,
  mockGetGroupId,
  mockGetGroupMemberIdentity,
  mockGetStoredExecutorIdentity,
} = vi.hoisted(() => ({
  mockGetContextIdentity: vi.fn(),
  mockGetContextMemberIdentity: vi.fn(),
  mockGetGroupId: vi.fn(),
  mockGetGroupMemberIdentity: vi.fn(),
  mockGetStoredExecutorIdentity: vi.fn(),
}));

vi.mock("@calimero-network/mero-react", () => ({
  getContextIdentity: mockGetContextIdentity,
}));

vi.mock("../constants/config", () => ({
  getContextMemberIdentity: mockGetContextMemberIdentity,
  getGroupId: mockGetGroupId,
  getGroupMemberIdentity: mockGetGroupMemberIdentity,
}));

vi.mock("./messengerName", () => ({
  getStoredExecutorIdentity: mockGetStoredExecutorIdentity,
}));

import { isSelfSender } from "./selfIdentity";

describe("isSelfSender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContextIdentity.mockReturnValue("");
    mockGetContextMemberIdentity.mockReturnValue("");
    mockGetGroupId.mockReturnValue("group-1");
    mockGetGroupMemberIdentity.mockReturnValue("");
    mockGetStoredExecutorIdentity.mockReturnValue("");
  });

  it("matches the per-context member identity", () => {
    mockGetContextMemberIdentity.mockReturnValue("ctx-identity");
    expect(isSelfSender("ctx-identity", "ctx-1")).toBe(true);
  });

  it("matches when only the GLOBAL identity is set (the old single source)", () => {
    mockGetContextIdentity.mockReturnValue("global-identity");
    expect(isSelfSender("global-identity", "ctx-1")).toBe(true);
  });

  it("matches when only the namespace member identity is set", () => {
    mockGetGroupMemberIdentity.mockReturnValue("group-identity");
    expect(isSelfSender("group-identity", "ctx-1")).toBe(true);
  });

  it("matches a caller hint (identity map / active chat)", () => {
    expect(isSelfSender("hinted", "ctx-1", "hinted")).toBe(true);
  });

  it("matches the real sender when the identity map holds a DIFFERENT one", () => {
    // The actual bug: contextIdentityMap comes from fetchContextIdentities()[0],
    // which need not be the identity that signed the message. The message is
    // still ours via the per-context record.
    mockGetContextMemberIdentity.mockReturnValue("signing-identity");
    expect(isSelfSender("signing-identity", "ctx-1", "map-identity-0")).toBe(
      true,
    );
  });

  it("does not match another member", () => {
    mockGetContextMemberIdentity.mockReturnValue("mine");
    mockGetContextIdentity.mockReturnValue("mine-global");
    expect(isSelfSender("someone-else", "ctx-1", "map-identity")).toBe(false);
  });

  it("is false for an empty sender", () => {
    mockGetContextMemberIdentity.mockReturnValue("mine");
    expect(isSelfSender("", "ctx-1")).toBe(false);
    expect(isSelfSender(undefined, "ctx-1")).toBe(false);
  });

  it("ignores empty candidates rather than matching an empty sender", () => {
    expect(isSelfSender("", "ctx-1", "")).toBe(false);
  });
});
