import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { HOME_PACKAGE, appLabel, type Target } from "@calimero-apps/connect";

import { ManageInHomeLink } from "./HomeLink";
import type { Session } from "./session";

const PAGE = `https://${appLabel("com.calimero.mero-forum")}.apps.calimero.network/1.0.0/`;
const HOME = `https://${appLabel(HOME_PACKAGE)}.apps.calimero.network/0.3.0/?org=org-1`;
const TARGET: Target = { kind: "cloud", cluster: "x.apps.calimero.network", nodes: ["https://n1"], minReleaseVersion: "1" };

function session(role: string, mode: string, home = true): Session {
  const client = {
    package: vi.fn(async (pkg: string) => {
      if (!home) throw new Error("no such package");
      return { package: pkg, latest: "0.3.0", versions: [{ version: "0.3.0" }] };
    }),
    me: vi.fn(async () => ({ orgs: [{ orgId: "org-1", name: "Acme", role }] })),
    getOrg: vi.fn(async () => ({ orgId: "org-1", mode })),
  } as unknown as CalimeroClient;
  return { status: "signed-in", client, target: TARGET, accountId: "acc-1" };
}

describe("ManageInHomeLink", () => {
  it("links an admin to the org in Calimero Home, in a new tab", async () => {
    render(<ManageInHomeLink session={session("admin", "standalone")} org="org-1" href={PAGE} />);
    const link = await screen.findByTestId("manage-in-home");
    expect(link.getAttribute("href")).toBe(HOME);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).toBe("Manage people in Calimero Home →");
  });

  it("renders nothing for a member of an open org, without Home, or signed out", async () => {
    const member = session("member", "standalone");
    const noHome = session("owner", "shared", false);
    const { container } = render(
      <>
        <ManageInHomeLink session={member} org="org-1" href={PAGE} />
        <ManageInHomeLink session={noHome} org="org-1" href={PAGE} />
        <ManageInHomeLink session={{ status: "connecting" }} org="org-1" href={PAGE} />
      </>,
    );
    const clientOf = (s: Session) => (s.status === "signed-in" ? s.client : null);
    await waitFor(() => expect(clientOf(member)?.getOrg).toHaveBeenCalled());
    await waitFor(() => expect(clientOf(noHome)?.package).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-testid=manage-in-home]")).toBeNull();
  });
});
