import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { AppDeps } from "./deps";
import type { MatrixEnv } from "./conformance/matrix";
import type { Row } from "./conformance/types";

afterEach(cleanup);

const row = (name: string, pass: boolean): Row => ({
  name: `Calls / ${name}`,
  area: "Calls",
  who: "A",
  expected: "ok",
  actual: pass ? "ok" : "NOT_FOUND",
  pass,
  ms: 1,
});

function deps(over: Partial<AppDeps> = {}): AppDeps {
  return {
    env: { VITE_CALIMERO_TARGET: "local" },
    origin: "http://localhost:5173",
    run: vi.fn(async (env: MatrixEnv) => {
      const rows = [row("set", true), row("get", false)];
      rows.forEach((r) => env.onRow?.(r));
      return rows;
    }),
    servedNodes: () => Promise.resolve(null),
    ...over,
  };
}

describe("the page", () => {
  it("says why a production build without a cluster cannot connect", async () => {
    render(<App deps={deps({ env: { VITE_CALIMERO_TARGET: "cloud" } })} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/VITE_CALIMERO_CLUSTER/);
  });

  it("runs the matrix on the picked component and shows each row", async () => {
    const d = deps();
    render(<App deps={d} />);
    expect((await screen.findByTestId("target")).textContent).toBe("local: 3 nodes");
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "Run the matrix" });
    expect(button.disabled).toBe(true);
    const file = new File([new Uint8Array([0, 0x61, 0x73, 0x6d])], "conformance.wasm");
    fireEvent.change(screen.getByLabelText("component"), { target: { files: [file] } });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect((await screen.findByTestId("summary")).textContent).toBe("1/2 pass");
    expect(screen.getByText("Calls / get").closest("tr")?.className).toBe("fail");
    const env = (d.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as MatrixEnv;
    expect(env.wasm).toEqual(new Uint8Array([0, 0x61, 0x73, 0x6d]));
  });
});
