// Settings → Agents listed the feed's owner as a bare account id, even when the
// owner had a name on the namespace.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { SettingsView } from "./SettingsView";
import { DemoBackend } from "./demo";
import { useFeed } from "./useFeed";

function Harness({ namePerson }: { namePerson?: (identity: string) => Promise<string> }) {
  const [backend] = useState(() => new DemoBackend(true, 0));
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return (
    <MemoryRouter>
      <SettingsView feed={{ ...feed, namePerson }} contextId={null} section="agents" />
    </MemoryRouter>
  );
}

describe("Settings: the owner by name", () => {
  it("names the owner, with the id beside it", async () => {
    const named = async (id: string) => (id === "demo-account" ? "Sandi" : "");
    render(<Harness namePerson={named} />);
    const owner = (await screen.findByText("Owner")).nextElementSibling as HTMLElement;
    await screen.findByText("Sandi");
    expect(owner).toHaveTextContent("Sandi");
    expect(owner).toHaveTextContent("demo-account");
  });

  it("shows the id alone when nobody named the owner", async () => {
    render(<Harness />);
    const owner = (await screen.findByText("Owner")).nextElementSibling as HTMLElement;
    expect(owner).toHaveTextContent("demo-account");
  });
});
