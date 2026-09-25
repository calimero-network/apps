import { describe, expect, it } from "vitest";
import {
  getChannelVisibilityOption,
  getChannelVisibilityOptionLabel,
  getContextVisibilityLabel,
  getContextVisibilityModeFromOption,
  isRestrictedChannelType,
} from "./channelVisibility";

describe("getChannelVisibilityOption", () => {
  it("defaults the modal to public when the group default is open", () => {
    expect(getChannelVisibilityOption("open")).toBe("public");
  });

  it("defaults the modal to private when the group default is restricted", () => {
    expect(getChannelVisibilityOption("restricted")).toBe("private");
  });
});

describe("getContextVisibilityModeFromOption", () => {
  it("creates an open context when the user keeps or selects public", () => {
    expect(getContextVisibilityModeFromOption("public")).toBe("open");
  });

  it("creates a restricted context when the user switches to private", () => {
    expect(getContextVisibilityModeFromOption("private")).toBe("restricted");
  });
});

describe("visibility labels", () => {
  it("shows Public for the public modal option", () => {
    expect(getChannelVisibilityOptionLabel("public")).toBe("Public");
  });

  it("shows Private for the private modal option", () => {
    expect(getChannelVisibilityOptionLabel("private")).toBe("Private");
  });

  it("shows Public for open contexts", () => {
    expect(getContextVisibilityLabel("open")).toBe("Public");
  });

  it("shows Private for restricted contexts", () => {
    expect(getContextVisibilityLabel("restricted")).toBe("Private");
  });
});

describe("isRestrictedChannelType", () => {
  it("treats Private (current label) as restricted", () => {
    expect(isRestrictedChannelType("Private")).toBe(true);
  });

  it("keeps backward compatibility with the legacy Restricted label", () => {
    expect(isRestrictedChannelType("Restricted")).toBe(true);
  });

  it("treats Public channels as not restricted", () => {
    expect(isRestrictedChannelType("Public")).toBe(false);
  });
});
