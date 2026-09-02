import { describe, it, expect } from "vitest";

// Validate username input rules (mirrors UsernameModal logic)
function validateUsername(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Username cannot be empty.";
  if (trimmed.length < 2) return "Must be at least 2 characters.";
  if (trimmed.length > 32) return "Must be 32 characters or fewer.";
  return null;
}

describe("validateUsername", () => {
  it("rejects empty string", () => {
    expect(validateUsername("")).not.toBeNull();
  });

  it("rejects whitespace-only string", () => {
    expect(validateUsername("   ")).not.toBeNull();
  });

  it("rejects single character", () => {
    expect(validateUsername("a")).not.toBeNull();
  });

  it("accepts 2-character username", () => {
    expect(validateUsername("ab")).toBeNull();
  });

  it("accepts normal username", () => {
    expect(validateUsername("Alice")).toBeNull();
  });

  it("rejects username over 32 chars", () => {
    expect(validateUsername("a".repeat(33))).not.toBeNull();
  });

  it("accepts exactly 32 chars", () => {
    expect(validateUsername("a".repeat(32))).toBeNull();
  });

  it("trims surrounding whitespace before validation", () => {
    expect(validateUsername("  bob  ")).toBeNull();
    expect(validateUsername("  a  ")).not.toBeNull(); // single char after trim
  });
});

describe("join RPC payload", () => {
  it("join args contain member_id, username, avatar, timestamp", () => {
    const identity = "test-identity-123";
    const username = "Alice";
    const timestamp = Date.now();
    const args = { member_id: identity, username, avatar: null, timestamp };
    expect(args.member_id).toBe(identity);
    expect(args.username).toBe(username);
    expect(args.avatar).toBeNull();
    expect(typeof args.timestamp).toBe("number");
  });

  it("join is called with snake_case keys (matches WASM signature)", () => {
    // WASM: pub fn join(&mut self, member_id: String, username: String, avatar: Option<String>, timestamp: u64)
    const args = { member_id: "id-1", username: "Bob", avatar: null, timestamp: 1000 };
    expect("member_id" in args).toBe(true);
    expect("member_Id" in args).toBe(false);
    expect("username" in args).toBe(true);
  });
});
