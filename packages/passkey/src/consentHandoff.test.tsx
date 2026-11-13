import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConsentHandoff, confirmConsentHandoff } from "./ConsentHandoff";

afterEach(() => {
  document.body.innerHTML = "";
});

async function shown(options: Parameters<typeof confirmConsentHandoff>[0]) {
  let answer!: Promise<boolean>;
  await act(async () => {
    answer = confirmConsentHandoff(options);
  });
  return { answer, dialog: await screen.findByRole("dialog") };
}

describe("ConsentHandoff", () => {
  it("shows the code and the action in a labelled modal dialog, focusing Continue", () => {
    render(
      <ConsentHandoff code="ABC-DEF" action="Create the workspace “Acme”" onContinue={vi.fn()} onCancel={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Approve on your Calimero node" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByTestId("consent-handoff-code").textContent).toBe("ABC-DEF");
    expect(screen.getByTestId("consent-handoff-action").textContent).toBe("Create the workspace “Acme”");
    expect(screen.getByText("Check that page shows this code.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId("consent-handoff-continue"));
  });

  it("keeps Tab inside the dialog", () => {
    render(<ConsentHandoff code="X" onContinue={vi.fn()} onCancel={vi.fn()} />);
    const cancel = screen.getByTestId("consent-handoff-cancel");
    const go = screen.getByTestId("consent-handoff-continue");
    fireEvent.keyDown(go, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(go);
  });
});

describe("confirmConsentHandoff", () => {
  it("answers true on Continue, then removes the dialog and gives focus back", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { answer } = await shown({ code: "ABC-DEF" });
    expect(screen.getByTestId("consent-handoff-code").textContent).toBe("ABC-DEF");
    fireEvent.click(screen.getByTestId("consent-handoff-continue"));
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".cp-consent-host")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("answers false on Cancel", async () => {
    const { answer } = await shown({ code: "ABC-DEF" });
    fireEvent.click(screen.getByTestId("consent-handoff-cancel"));
    await expect(answer).resolves.toBe(false);
    expect(document.querySelector(".cp-consent-host")).toBeNull();
  });

  it("answers false on Esc and on the backdrop", async () => {
    const esc = await shown({ code: "A" });
    fireEvent.keyDown(esc.dialog, { key: "Escape" });
    await expect(esc.answer).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const backdrop = await shown({ code: "B" });
    fireEvent.mouseDown(screen.getByTestId("consent-handoff"));
    await expect(backdrop.answer).resolves.toBe(false);
    expect(document.body.children.length).toBe(0);
  });

  it("does not cancel on a press inside the card", async () => {
    const { answer, dialog } = await shown({ code: "A" });
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("consent-handoff-continue"));
    await expect(answer).resolves.toBe(true);
  });
});
