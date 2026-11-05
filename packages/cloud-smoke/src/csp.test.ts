import { cspSources, missingConnectSources } from "./csp";
import { DEFAULT_PACKAGES, parsePackages, smokeTargets } from "./config";

// The header eu-shared-2 served for kv-store on merod rc.9, before core#4861.
const RC9 =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data: blob:; object-src 'none'; " +
  "connect-src 'self' https://eu-shared-2-n1.relay.cloud.calimero.network https://eu-shared-2-n2.relay.cloud.calimero.network";
const NODES = [
  "https://eu-shared-2-n1.relay.cloud.calimero.network",
  "https://eu-shared-2-n2.relay.cloud.calimero.network",
];

describe("missingConnectSources", () => {
  it("names the cloud mirror the rc.9 policy left out (core#4861)", () => {
    expect(missingConnectSources(RC9, ["https://cloud.calimero.network", ...NODES])).toEqual([
      "https://cloud.calimero.network",
    ]);
  });

  it("passes once the mirror is allowed, whatever the trailing slash", () => {
    const fixed = RC9.replace("connect-src 'self'", "connect-src 'self' https://cloud.calimero.network/");
    expect(missingConnectSources(fixed, ["https://cloud.calimero.network", ...NODES])).toEqual([]);
  });

  it("names a node the policy does not list", () => {
    expect(missingConnectSources(RC9, ["https://eu-shared-2-n3.relay.cloud.calimero.network"])).toEqual([
      "https://eu-shared-2-n3.relay.cloud.calimero.network",
    ]);
  });

  it("falls back to default-src when there is no connect-src", () => {
    expect(cspSources("default-src 'self' https://a.example", "connect-src")).toEqual(["'self'", "https://a.example"]);
    expect(missingConnectSources("default-src 'self'", ["https://a.example"])).toEqual(["https://a.example"]);
  });
});

describe("smokeTargets", () => {
  it("defaults to kv-store at its served host", () => {
    expect(parsePackages(undefined)).toEqual(DEFAULT_PACKAGES);
    expect(smokeTargets({})).toEqual([
      {
        package: "com.calimero.kv-store",
        url: "https://2g7omgwwdshuse6hygzvhssf4w3ute5zc3vjlpor7zknkoyrwxdq.apps.calimero.network/",
      },
    ]);
  });

  it("takes a comma or space separated list", () => {
    expect(parsePackages("com.a, com.b com.a\ncom.c")).toEqual(["com.a", "com.b", "com.c"]);
  });

  it("refuses SMOKE_URL with more than one package", () => {
    expect(() => smokeTargets({ SMOKE_PACKAGES: "com.a,com.b", SMOKE_URL: "https://x.example/" })).toThrow(/one/);
  });
});
