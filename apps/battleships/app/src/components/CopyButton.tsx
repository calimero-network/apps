import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Copy-to-clipboard, in this app's own button styles.
 *
 * mero-ui ships a `CopyToClipboard`, but it renders with the library's dark
 * palette and its own shape, so on a light surface it sat among the app's
 * buttons looking like it came from somewhere else. The behaviour is four
 * lines; the styling is the part that has to match.
 *
 * Confirmation is shown IN the button rather than as a toast — the feedback
 * belongs where the click happened.
 */
export default function CopyButton({
  text,
  label,
  copiedLabel,
  className,
}: {
  text: string;
  label: string;
  copiedLabel: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  // Cleared on unmount: the lobby re-renders often, and a pending timer that
  // fires into a gone component is a React warning and a leak.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard is permission-gated and absent over plain http on some
      // hosts. Say nothing rather than throwing — the value is still on screen
      // to select by hand.
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, [text]);

  return (
    <button type="button" className={className} onClick={copy} aria-label={label}>
      {copied ? copiedLabel : label}
    </button>
  );
}
