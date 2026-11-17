import { renderHook, waitFor } from "@testing-library/react";
import { withRoutes } from "@calimero-apps/connect/testing";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { SceneContext, type SceneSession } from "../scene";
import { useJoin } from "./hooks";

function setup(members: { id: string; name: string }[]) {
  const fake = {
    call: vi.fn(async () => ({ index: 2, result: null as unknown, events: [] })),
    view: vi.fn(async () => ({
      index: 1,
      result: members.map((m) => ({ ...m, role: "editor", joinedAt: "0" })) as unknown,
    })),
  };
  const scene = {
    appId: "scene-1",
    name: "Scene",
    org: "org-1",
    client: withRoutes(fake),
    accountId: "acct-ada",
    after: () => {},
    passkey: () => ({}) as never,
    leave: () => {},
    logout: () => {},
  } as unknown as SceneSession;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(SceneContext.Provider, { value: scene }, children);
  return { fake, wrapper };
}

describe("useJoin", () => {
  it("sends nothing when the scene already lists this account under the name", async () => {
    const { fake, wrapper } = setup([{ id: "acct-ada", name: "Ada" }]);
    renderHook(() => useJoin("scene-1", "Ada"), { wrapper });
    await waitFor(() => expect(fake.view).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.call).not.toHaveBeenCalled();
  });

  it("joins when the account is missing or listed under another name", async () => {
    const { fake, wrapper } = setup([{ id: "acct-ada", name: "Guest" }]);
    renderHook(() => useJoin("scene-1", "Ada"), { wrapper });
    await waitFor(() =>
      expect(fake.call).toHaveBeenCalledWith("scene-1", "join", expect.objectContaining({ name: "Ada" })),
    );
  });
});
