import { describe, expect, it, vi } from "vitest";
import { closeSharedDialogsOnBackdrop } from "./backdropClose";

function dialog() {
  document.body.innerHTML = `<div class="mero-cw mero-cw-overlay"><div class="mero-cw-card"><button class="mero-cw-x"></button><p>body</p></div></div>`;
  const x = document.querySelector<HTMLButtonElement>(".mero-cw-x")!;
  const onX = vi.fn();
  x.addEventListener("click", onX);
  return { overlay: document.querySelector<HTMLElement>(".mero-cw-overlay")!, card: document.querySelector<HTMLElement>("p")!, onX };
}
const press = (el: HTMLElement) => el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
const release = (el: HTMLElement) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("closeSharedDialogsOnBackdrop", () => {
  it("presses ✕ on a click on the backdrop", () => {
    const stop = closeSharedDialogsOnBackdrop();
    const { overlay, onX } = dialog();
    press(overlay);
    release(overlay);
    expect(onX).toHaveBeenCalledTimes(1);
    stop();
  });
  it("leaves clicks in the card, and drags that end outside, alone", () => {
    const stop = closeSharedDialogsOnBackdrop();
    const { overlay, card, onX } = dialog();
    press(card);
    release(card);
    press(card);
    release(overlay);
    expect(onX).not.toHaveBeenCalled();
    stop();
  });
});
