import { beforeEach, describe, expect, it } from "vitest";
import { setGroupId } from "../constants/config";
import {
  clearNamespaceReady,
  isNamespaceReady,
  setNamespaceReady,
} from "./session";

// A browser restart, a new tab or a PWA relaunch: sessionStorage starts empty,
// localStorage carries over.
const restart = () => sessionStorage.clear();

describe("namespace-ready gate", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("lands a returning user back in the workspace they entered", () => {
    setGroupId("ns-a");
    setNamespaceReady("ns-a");

    restart();

    expect(isNamespaceReady()).toBe(true);
  });

  it("is not ready before any workspace was entered", () => {
    setGroupId("ns-a");

    expect(isNamespaceReady()).toBe(false);
  });

  it("does not open a workspace other than the one entered", () => {
    setNamespaceReady("ns-a");
    // The group id moved on without going through entry (a `group-id` link,
    // another tab, a stale value): the marker must not vouch for it.
    setGroupId("ns-b");

    restart();

    expect(isNamespaceReady()).toBe(false);
  });

  it("is not ready once the group selection is gone", () => {
    setGroupId("ns-a");
    setNamespaceReady("ns-a");
    localStorage.removeItem("calimero_group_id");

    restart();

    expect(isNamespaceReady()).toBe(false);
  });

  it("is cleared for good, not just for this tab", () => {
    setGroupId("ns-a");
    setNamespaceReady("ns-a");

    clearNamespaceReady();
    restart();

    expect(isNamespaceReady()).toBe(false);
  });

  it("still honours the per-tab flag an older build set", () => {
    setGroupId("ns-a");
    sessionStorage.setItem("curb_ns_ready", "1");

    expect(isNamespaceReady()).toBe(true);
  });

  it("carries an older build's per-tab flag over a restart once it is read", () => {
    setGroupId("ns-a");
    sessionStorage.setItem("curb_ns_ready", "1");
    isNamespaceReady();

    restart();

    expect(isNamespaceReady()).toBe(true);
  });

  it("clears an older build's per-tab flag too", () => {
    setGroupId("ns-a");
    sessionStorage.setItem("curb_ns_ready", "1");

    clearNamespaceReady();

    expect(isNamespaceReady()).toBe(false);
  });
});
