import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChessBoard } from "./ChessBoard";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("ChessBoard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // React commits the board before it runs the board's effects. A click in
  // that gap (a quick player, a slow machine, CI) used to be undone by the
  // effect that clears the selection, so the move never went out.
  it("keeps a selection made the moment the board appears", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onMove = vi.fn();
    const appeared = new Promise<void>((resolve) => {
      const seen = new MutationObserver(() => {
        const e2 = container.querySelector<HTMLButtonElement>("[data-testid=square-e2]");
        if (!e2) return;
        seen.disconnect();
        // Committed, its effects not yet run: the gap.
        e2.click();
        resolve();
      });
      seen.observe(container, { childList: true, subtree: true });
    });
    const root = createRoot(container);
    root.render(<ChessBoard fen={START} legalMoves={["e2e3", "e2e4"]} flipped={false} interactive onMove={onMove} />);
    await appeared;
    await new Promise((r) => setTimeout(r, 20));
    container.querySelector<HTMLButtonElement>("[data-testid=square-e4]")!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(onMove).toHaveBeenCalledWith("e2e4");
    root.unmount();
  });
});
