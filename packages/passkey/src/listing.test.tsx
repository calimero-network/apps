import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppListing } from "./AppListing";
import { listingCopy, renderListing } from "./listing";

// `com.calimero.kv-store`'s label, as mdma's `app_host.label` computes it.
const KV_URL = "https://2g7omgwwdshuse6hygzvhssf4w3ute5zc3vjlpor7zknkoyrwxdq.apps.calimero.network/";
const props = { name: "KV Store", description: "A key-value store.", package: "com.calimero.kv-store", dir: "kv-store" };

describe("AppListing", () => {
  it("opens the copy Calimero Cloud serves and offers deploying one", () => {
    render(<AppListing {...props} />);
    expect(screen.getByRole("heading", { name: "KV Store" })).toBeTruthy();
    expect(screen.getByText("A key-value store.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open KV Store" }).getAttribute("href")).toBe(KV_URL);
    expect(screen.getByText("This link works once KV Store runs on Calimero Cloud.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Deploy your own on Calimero Cloud" }).getAttribute("href")).toBe(
      "https://cloud.calimero.network/v2",
    );
    expect(screen.queryByTestId("listing-dev")).toBeNull();
    // No developer error on the listing.
    expect(screen.queryByText(/VITE_CALIMERO_CLUSTER/)).toBeNull();
  });

  it("shows the local-play command in a development build only", () => {
    render(<AppListing {...props} dev />);
    expect(screen.getByTestId("listing-dev").textContent).toBe("For local play run pnpm dev:local kv-store.");
  });
});

describe("renderListing", () => {
  it("builds the same listing without React", () => {
    const host = document.createElement("div");
    host.innerHTML = "<p>old</p>";
    const root = renderListing(host, { ...props, dev: true }, "mine");
    expect(root.className).toBe("cp-listing mine");
    expect(host.querySelector("p")?.textContent).not.toBe("old");
    const open = host.querySelector<HTMLAnchorElement>("[data-testid=listing-open]")!;
    expect(open.textContent).toBe("Open KV Store");
    expect(open.getAttribute("href")).toBe(KV_URL);
    expect(host.querySelector("[data-testid=listing-deploy]")?.getAttribute("href")).toBe(
      "https://cloud.calimero.network/v2",
    );
    expect(host.querySelector("[data-testid=listing-dev]")?.textContent).toBe(
      listingCopy({ ...props, dev: true }).devCommand && "For local play run pnpm dev:local kv-store.",
    );
  });

  it("escapes what it is given", () => {
    const host = document.createElement("div");
    renderListing(host, { name: "<b>x</b>", package: "p" });
    expect(host.querySelector("b")).toBeNull();
    expect(host.querySelector("h2")?.textContent).toBe("<b>x</b>");
  });
});
