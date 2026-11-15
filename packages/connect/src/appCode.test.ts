import { describe, expect, it, vi } from "vitest";
import type { AppsReport, NodeVerification, PackageCapabilities } from "@calimero-network/mero-js";

import { checkAppCode, type CodeCheckClient } from "./appCode";

const HASH = "ab".repeat(32);
const OTHER = "cd".repeat(32);

function verification(appHash: string | null, mock: boolean): NodeVerification {
  return { url: "https://node.example", mock, checkedAt: 1700, ...(appHash ? { appHash } : {}) };
}

const PACKAGE = "com.example.app";
type Ref = { package: string; version: string; service?: string; compute?: boolean };

function client(options: {
  attested?: string | null | Error;
  mock?: boolean;
  bundle?: string | Error;
  /** Per version; the others answer `bundle`. */
  bundles?: Record<string, string>;
  capabilitiesService?: string | null;
  ref?: Ref | null;
  /** The release lists several services, so a lookup must name one. */
  multiService?: boolean;
}): CodeCheckClient & { attestApp: ReturnType<typeof vi.fn>; packageCapabilities: ReturnType<typeof vi.fn> } {
  const { attested = HASH, mock = false, bundle = HASH, bundles = {}, capabilitiesService = null, ref = { package: PACKAGE, version: "1.2.0" }, multiService = false } = options;
  return {
    attestApp: vi.fn(async () => {
      if (attested instanceof Error) throw attested;
      return verification(attested, mock);
    }),
    packageCapabilities: vi.fn(async (_pkg: string, version: string, options?: { service?: string }) => {
      if (multiService && !options?.service) throw new Error("400 NO_SUCH_SERVICE");
      if (bundle instanceof Error) throw bundle;
      return { bundle: bundles[version] ?? bundle, service: capabilitiesService } as PackageCapabilities;
    }),
    // `compute` is on the app record's release, not in the report.
    apps: { get: vi.fn(async () => ({ org: null, release: ref }) as never) },
    appsReportAll: vi.fn(
      async () => ({ apps: [{ app: "app-1", package: ref && { ...ref, compute: undefined } }] }) as unknown as AppsReport,
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
      package: PACKAGE,
      version: "1.2.0",
    });
    expect(c.attestApp).toHaveBeenCalledWith("app-1");
    expect(c.packageCapabilities).toHaveBeenCalledWith("com.example.app", "1.2.0", undefined);
  });

  it("expects the hash of the release the instance runs, not the source's version", async () => {
    const c = client({ ref: { package: PACKAGE, version: "1.3.0" }, bundles: { "1.2.0": OTHER } });
    expect(await checkAppCode(c, "app-1", { package: PACKAGE, version: "1.2.0" })).toMatchObject({
      status: "match",
      package: PACKAGE,
      version: "1.3.0",
    });
    expect((await checkAppCode(c, "app-1", { package: PACKAGE })).status).toBe("match");
    expect(c.packageCapabilities).toHaveBeenCalledTimes(2);
    expect(c.packageCapabilities).toHaveBeenCalledWith(PACKAGE, "1.3.0", undefined);
  });

  it("is never a match for a mock quote", async () => {
    const c = client({ mock: true });
    expect(await checkAppCode(c, "app-1", { package: PACKAGE })).toEqual({
      status: "unknown",
      reason: "test server: the node's quote is a mock",
    });
    expect((await checkAppCode(client({ mock: true }), "app-1", HASH)).status).toBe("unknown");
  });

  it("is unknown when the instance's service is not the capabilities' service", async () => {
    const other = client({ ref: { package: PACKAGE, version: "1.2.0", service: "worker" }, capabilitiesService: "web" });
    expect(await checkAppCode(other, "app-1", { package: PACKAGE })).toMatchObject({ status: "unknown" });
    const none = client({ ref: { package: PACKAGE, version: "1.2.0", service: "worker" }, capabilitiesService: null });
    expect((await checkAppCode(none, "app-1", { package: PACKAGE })).status).toBe("unknown");
    const same = client({ ref: { package: PACKAGE, version: "1.2.0", service: "worker" }, capabilitiesService: "worker" });
    expect((await checkAppCode(same, "app-1", { package: PACKAGE })).status).toBe("match");
  });

  it("asks for the running service, so a multi-service release is checked", async () => {
    const c = client({ ref: { package: PACKAGE, version: "1.2.0", service: "worker" }, capabilitiesService: "worker", multiService: true });
    expect((await checkAppCode(c, "app-1", { package: PACKAGE })).status).toBe("match");
    expect(c.packageCapabilities).toHaveBeenCalledWith(PACKAGE, "1.2.0", { service: "worker" });
  });

  it("is unknown when the listing names a service the instance's default does not", async () => {
    const c = client({ capabilitiesService: "web" });
    expect(await checkAppCode(c, "app-1", { package: PACKAGE })).toMatchObject({ status: "unknown" });
  });

  it("treats a listing with no service as the default service", async () => {
    const c = client({});
    c.packageCapabilities.mockResolvedValue({ bundle: HASH } as PackageCapabilities);
    expect((await checkAppCode(c, "app-1", { package: PACKAGE })).status).toBe("match");
  });

  it("is unknown for a compute-only instance", async () => {
    const c = client({ ref: { package: PACKAGE, version: "1.2.0", compute: true } });
    expect(await checkAppCode(c, "app-1", { package: PACKAGE })).toEqual({
      status: "unknown",
      reason: "compute-only instance",
    });
    expect(c.packageCapabilities).not.toHaveBeenCalled();
  });

  it("is unknown when the instance runs another package than the source's", async () => {
    const c = client({ ref: { package: "com.example.other", version: "1.2.0" } });
    expect(await checkAppCode(c, "app-1", { package: PACKAGE })).toMatchObject({ status: "unknown" });
    expect(c.packageCapabilities).not.toHaveBeenCalled();
  });

  it("ignores whitespace around either hash", async () => {
    const c = client({ attested: ` ${HASH}\n`, bundle: `\t${HASH} ` });
    expect((await checkAppCode(c, "app-1", { package: PACKAGE })).status).toBe("match");
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
    const c = client({ ref: null });
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
