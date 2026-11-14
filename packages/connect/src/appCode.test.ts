import { describe, expect, it, vi } from "vitest";
import type { AppsReport, NodeVerification, PackageCapabilities } from "@calimero-network/mero-js";

import { checkAppCode, type CodeCheckClient } from "./appCode";

const HASH = "ab".repeat(32);
const OTHER = "cd".repeat(32);

function verification(appHash: string | null): NodeVerification {
  return { url: "https://node.example", mock: false, checkedAt: 1700, ...(appHash ? { appHash } : {}) };
}

function client(options: {
  attested?: string | null | Error;
  bundle?: string | Error;
  release?: string | null;
}): CodeCheckClient & { attestApp: ReturnType<typeof vi.fn>; packageCapabilities: ReturnType<typeof vi.fn> } {
  const { attested = HASH, bundle = HASH, release = "1.2.0" } = options;
  return {
    attestApp: vi.fn(async () => {
      if (attested instanceof Error) throw attested;
      return verification(attested);
    }),
    packageCapabilities: vi.fn(async () => {
      if (bundle instanceof Error) throw bundle;
      return { bundle } as PackageCapabilities;
    }),
    apps: { get: vi.fn(async () => ({ org: null }) as never) },
    appsReportAll: vi.fn(
      async () => ({ apps: [{ app: "app-1", package: release ? { package: "p", version: release } : null }] }) as unknown as AppsReport,
    ),
  };
}

describe("checkAppCode", () => {
  it("matches when the node-bound hash is the release's bundle hash, in any hex case", async () => {
    const c = client({ bundle: HASH.toUpperCase() });
    expect(await checkAppCode(c, "app-1", { package: "com.example.app", version: "1.2.0" })).toEqual({
      status: "match",
      appHash: HASH,
      checkedAt: 1700,
    });
    expect(c.attestApp).toHaveBeenCalledWith("app-1");
    expect(c.packageCapabilities).toHaveBeenCalledWith("com.example.app", "1.2.0");
  });

  it("reads the release the instance runs when the source names no version", async () => {
    const c = client({ release: "1.3.0" });
    expect((await checkAppCode(c, "app-1", { package: "com.example.app" })).status).toBe("match");
    expect(c.packageCapabilities).toHaveBeenCalledWith("com.example.app", "1.3.0");
  });

  it("is a mismatch, with both hashes, when the node runs other code", async () => {
    const c = client({ attested: OTHER });
    expect(await checkAppCode(c, "app-1", { package: "com.example.app", version: "1.2.0" })).toEqual({
      status: "mismatch",
      appHash: OTHER,
      expected: HASH,
    });
  });

  it("is unknown, never a match, when the attestation is refused", async () => {
    const c = client({ attested: new Error("quote refused") });
    expect(await checkAppCode(c, "app-1", { package: "com.example.app", version: "1.2.0" })).toEqual({
      status: "unknown",
      reason: "quote refused",
    });
  });

  it("is unknown when the node binds no hash for the app", async () => {
    const c = client({ attested: null });
    expect(await checkAppCode(c, "app-1", { package: "com.example.app", version: "1.2.0" })).toEqual({
      status: "unknown",
      reason: "the node bound no code hash for this app",
    });
  });

  it("is unknown when the release lists no bundle hash or cannot be read", async () => {
    const missing = client({ bundle: "" });
    expect(await checkAppCode(missing, "app-1", { package: "com.example.app", version: "1.2.0" })).toMatchObject({
      status: "unknown",
    });
    const failing = client({ bundle: new Error("404 not found") });
    expect(await checkAppCode(failing, "app-1", { package: "com.example.app", version: "1.2.0" })).toEqual({
      status: "unknown",
      reason: "404 not found",
    });
    expect(missing.attestApp).not.toHaveBeenCalled();
  });

  it("is unknown when the instance's release is not known", async () => {
    const c = client({ release: null });
    expect((await checkAppCode(c, "app-1", { package: "com.example.app" })).status).toBe("unknown");
    expect(c.packageCapabilities).not.toHaveBeenCalled();
  });

  it("compares a dev bundle hash directly, without asking the registry", async () => {
    const same = client({});
    expect(await checkAppCode(same, "app-1", HASH.toUpperCase())).toEqual({ status: "match", appHash: HASH, checkedAt: 1700 });
    expect(same.packageCapabilities).not.toHaveBeenCalled();
    const other = client({ attested: OTHER });
    expect(await checkAppCode(other, "app-1", HASH)).toEqual({ status: "mismatch", appHash: OTHER, expected: HASH });
  });
});
