import type { CursorState, Member } from "../types";
import styles from "./CursorsOverlay.module.css";

const CURSOR_COLORS = [
  "#A5FF11", "#3aa0ff", "#ff5d6c", "#9b59b6",
  "#ffb02e", "#1abc9c", "#e67e22", "#e91e63",
];

function colorForIdentity(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length];
}

function shortLabel(identity: string): string {
  if (identity.length <= 8) return identity;
  return identity.slice(0, 4) + "…" + identity.slice(-4);
}

interface Props {
  cursors: CursorState[];
  myIdentity: string;
  members: Member[];
  /** Editor viewport — accepted for layout but not required by the overlay. */
  viewport?: { zoom: number; panX: number; panY: number };
}

// Generic remote-cursor renderer: given a cursor list and a member map, draws a
// labelled arrow per peer. Stale cursors (>10s) and the local user are hidden.
export default function CursorsOverlay({ cursors, myIdentity, members }: Props) {
  const now = Date.now();
  const active = cursors.filter((c) => c.identity !== myIdentity && now - c.updatedAt < 10_000);

  return (
    <div className={styles.overlay}>
      {active.map((c) => {
        const color = colorForIdentity(c.identity);
        const member = members.find((m) => m.id === c.identity);
        const label = member?.username ?? shortLabel(c.identity);
        return (
          <div
            key={c.identity}
            className={styles.cursor}
            style={{ left: c.x, top: c.y, "--cursor-color": color } as React.CSSProperties}
          >
            <svg className={styles.arrow} viewBox="0 0 16 22" fill="none">
              <path d="M0 0L0 16L4.5 12L7.5 20L9.5 19L6.5 11L12 11Z" fill={color} stroke="#0A0E13" strokeWidth="1" />
            </svg>
            <span className={styles.label} style={{ background: color }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
