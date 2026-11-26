import { CLOUD_ENVIRONMENTS } from "@calimero-network/mero-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CLOUD_LINKS, cloudLinks } from "./cloud";

const PRODUCTION = {
  console: "https://cloud.calimero.network",
  deploy: "https://cloud.calimero.network/deploy",
  appsDomain: "apps.calimero.network",
  registry: "https://apps.calimero.network",
};
const STAGING = {
  console: "https://staging.cloud.calimero.network",
  deploy: "https://staging.cloud.calimero.network/deploy",
  appsDomain: "apps.relay.staging.cloud.calimero.network",
  registry: "https://apps.staging.cloud.calimero.network",
};

describe("cloudLinks", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("pins each Calimero Cloud's public addresses", () => {
    expect(CLOUD_LINKS).toEqual({ production: PRODUCTION, staging: STAGING });
    // One entry per Cloud mero-js knows, keyed the same, on the apps domain
    // mero-js recognises that Cloud's served pages by.
    expect(Object.keys(CLOUD_LINKS).sort()).toEqual(Object.keys(CLOUD_ENVIRONMENTS).sort());
    expect(CLOUD_LINKS.staging.appsDomain).toBe(CLOUD_ENVIRONMENTS.staging.appsDomain);
    expect(CLOUD_LINKS.production.appsDomain).toBe(CLOUD_ENVIRONMENTS.production.appsDomain);
  });

  it("gives a staging build staging's addresses, and none of production's", () => {
    vi.stubEnv("VITE_CALIMERO_ENV", "staging");
    const links = cloudLinks();
    expect(links).toEqual(STAGING);
    for (const url of Object.values(links)) {
      expect(url).not.toMatch(/(^|\/\/)(cloud|apps)\.calimero\.network/);
    }
  });

  it("gives production's addresses to a build that names production, none or an unknown Cloud", () => {
    expect(cloudLinks()).toEqual(PRODUCTION);
    vi.stubEnv("VITE_CALIMERO_ENV", "production");
    expect(cloudLinks()).toEqual(PRODUCTION);
    vi.stubEnv("VITE_CALIMERO_ENV", "");
    expect(cloudLinks()).toEqual(PRODUCTION);
    // resolveTarget refuses this build; its links never throw while it renders.
    vi.stubEnv("VITE_CALIMERO_ENV", "dev");
    expect(cloudLinks()).toEqual(PRODUCTION);
  });
});
