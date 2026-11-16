// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Target } from "@calimero-apps/connect";

const h = vi.hoisted(() => ({ provider: vi.fn(), dialog: vi.fn(), resume: vi.fn() }));

vi.mock("@calimero-network/mero-react", () => ({
  MeroProvider: (p: { children: React.ReactNode }) => {
    h.provider(p);
    return <>{p.children}</>;
  },
  CreateWorkspaceDialog: (p: unknown) => {
    h.dialog(p);
    return <div data-testid="dialog" />;
  },
  useCreateWorkspaceResume: (o: unknown) => h.resume(o),
}));

import { WorkspaceCreator } from "./WorkspaceCreator";

const LOCAL: Target = { kind: "local", nodes: ["http://127.0.0.1:2501"] };
const CLOUD: Target = { kind: "cloud", cluster: "eu-shared-1", minReleaseVersion: "1.0.0" };

function mount(props: Partial<React.ComponentProps<typeof WorkspaceCreator>> = {}) {
  return render(
    <WorkspaceCreator
      client={{ session: undefined } as never}
      target={CLOUD}
      passkey={() => ({}) as never}
      source={{ package: "com.example.app", version: "2.0.0" }}
      pending={false}
      appPackage="com.example.app"
      open
      onClose={() => {}}
      onCreated={() => {}}
      {...props}
    />,
  );
}

beforeEach(() => h.resume.mockReturnValue({ message: null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkspaceCreator", () => {
  it("reviews the release the source is pinned to", () => {
    mount();
    expect(h.dialog.mock.calls[0]![0]).toMatchObject({ release: { package: "com.example.app", version: "2.0.0" } });
  });

  it("reviews a placeholder release for a raw bundle or an unversioned package", () => {
    mount({ source: { package: "com.example.app" } });
    expect(h.dialog.mock.calls[0]![0]).toMatchObject({ release: { package: "com.example.app", version: "unreleased" } });
  });

  it("says the release is being read, and shows no dialog until it is", () => {
    mount({ pending: true });
    expect(screen.getByRole("status").textContent).toContain("Checking the newest release");
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("shows no dialog while closed, but still resumes a full-page approval", () => {
    mount({ open: false });
    expect(screen.queryByTestId("dialog")).toBeNull();
    expect(h.resume).toHaveBeenCalled();
  });

  it("names the cluster for a cloud target and none for a local node", () => {
    mount();
    expect(h.provider.mock.calls[0]![0]).toMatchObject({ cluster: "Calimero Cloud eu-shared-1" });
    cleanup();
    h.provider.mockClear();
    mount({ target: LOCAL });
    expect(h.provider.mock.calls[0]![0]).not.toHaveProperty("cluster");
  });

  it("says why a full-page approval created nothing, and lets it be dismissed", () => {
    h.resume.mockReturnValue({ message: "You declined the request on your node. Nothing was created." });
    mount({ open: false });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("You declined the request");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
