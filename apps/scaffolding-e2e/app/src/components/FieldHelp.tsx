import { useState } from "react";

export function FieldHelp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--color-bg-input)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-muted)",
          fontSize: 10,
          fontWeight: 700,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ?
      </button>
      {open && (
        <span
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--color-neutral-800)",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 12,
            color: "var(--color-text-primary)",
            lineHeight: 1.5,
            maxWidth: 280,
            width: "max-content",
            zIndex: 100,
            pointerEvents: "none",
            whiteSpace: "normal",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
