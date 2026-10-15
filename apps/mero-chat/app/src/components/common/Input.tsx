import type { ComponentProps } from "react";
import { Input as MeroInput } from "@calimero-network/mero-ui";

// mero-ui's Input sets `color: #FFFFFF` as an inline style, written for its
// dark theme. On the chat's light surfaces that makes typed text white on
// white, and no stylesheet rule can beat an inline style without !important.
// Its `style` prop is spread last, so pass the theme's ink colour through it.
export function Input({ style, ...props }: ComponentProps<typeof MeroInput>) {
  return (
    <MeroInput {...props} style={{ color: "var(--glass-ink)", ...style }} />
  );
}
