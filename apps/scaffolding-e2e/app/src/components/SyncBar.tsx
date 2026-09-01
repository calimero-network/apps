interface SyncBarProps {
  pulse: boolean;
  sinceLabel: () => string;
  onRefresh: () => void;
}

export function SyncBar({ pulse, sinceLabel, onRefresh }: SyncBarProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        color: "var(--color-text-muted)",
        marginBottom: 12,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: pulse ? "var(--color-brand-600)" : "var(--color-border)",
          transition: "background 0.3s",
          flexShrink: 0,
        }}
      />
      <span>live · synced {sinceLabel()}</span>
      <button
        onClick={onRefresh}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--color-text-muted)",
          fontSize: 11,
          padding: 0,
          marginLeft: 4,
          textDecoration: "underline",
        }}
      >
        refresh now
      </button>
    </div>
  );
}
