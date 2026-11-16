import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { appOnlyInviteNote } from "@calimero-apps/connect";

vi.mock("../api/client", () => ({ getApi: () => ({ client: {}, passkey: () => ({}) }) }));
vi.mock("@calimero-network/mero-react", () => ({
  InviteDialog: (p: { labels?: { noun?: string; note?: string } }) =>
    createElement("pre", { "data-testid": "labels" }, JSON.stringify(p.labels)),
}));

import InviteModal from "./InviteModal";

const labels = () => JSON.parse(screen.getByTestId("labels").textContent ?? "");

describe("InviteModal", () => {
  it("adds the app-only note when the invite gives Mero Design only", () => {
    render(<InviteModal teamId="org-1" teamName="Studio" appOnly open onClose={() => {}} />);
    expect(labels()).toMatchObject({ noun: "team", note: appOnlyInviteNote("Mero Design") });
  });

  it("adds no note otherwise", () => {
    render(<InviteModal teamId="org-1" teamName="Studio" open onClose={() => {}} />);
    expect(labels().note).toBeUndefined();
  });
});
