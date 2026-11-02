import { describe, expect, it } from "vitest";

import { describeTarget } from "./session";

describe("describeTarget", () => {
  it("names the one target the build was set to", () => {
    expect(describeTarget({ kind: "local", nodes: ["http://127.0.0.1:2501"] })).toBe("merod local (1 node)");
    expect(describeTarget({ kind: "cloud", cluster: "eu-shared-1", minReleaseVersion: "1.0.0" })).toBe(
      "Calimero Cloud eu-shared-1",
    );
    expect(
      describeTarget({
        kind: "cloud",
        cluster: "crm-node.example.com",
        direct: true,
        nodes: ["https://crm-node.example.com"],
        minReleaseVersion: "1.0.0",
      }),
    ).toBe("node crm-node.example.com");
  });
});
