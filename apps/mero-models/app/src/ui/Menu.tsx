import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  shortcut?: string;
  icon?: ReactNode;
  disabled?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  /** A nested menu, opened on hover. */
  items?: MenuEntry[];
}

export type MenuEntry = MenuItem | "separator" | { heading: string };

/**
 * A menu bar: click a title to open it, hover across to the next while one is
 * open, Escape or a click elsewhere to close. `openName` lets a shortcut
 * (Shift+A) open a menu from outside.
 */
export function MenuBar({
  menus,
  openName,
  onOpenChange,
}: {
  menus: { name: string; items: MenuEntry[] }[];
  openName: string | null;
  onOpenChange: (name: string | null) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openName) return;
    const onDown = (e: PointerEvent) => {
      if (bar.current && !bar.current.contains(e.target as Node)) onOpenChange(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(null);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openName, onOpenChange]);

  return (
    <div className="menubar" ref={bar} role="menubar">
      {menus.map((m) => (
        <div key={m.name} className="menu-root">
          <button
            type="button"
            role="menuitem"
            className={`menu-title ${openName === m.name ? "open" : ""}`}
            onClick={() => onOpenChange(openName === m.name ? null : m.name)}
            onPointerEnter={() => openName && openName !== m.name && onOpenChange(m.name)}
          >
            {m.name}
          </button>
          {openName === m.name && <MenuList items={m.items} onDone={() => onOpenChange(null)} />}
        </div>
      ))}
    </div>
  );
}

export function MenuList({ items, onDone, style }: { items: MenuEntry[]; onDone: () => void; style?: React.CSSProperties }) {
  const [sub, setSub] = useState<number | null>(null);
  return (
    <div className="menu-list" role="menu" style={style}>
      {items.map((item, i) => {
        if (item === "separator") return <div key={i} className="menu-sep" role="separator" />;
        if ("heading" in item) {
          return (
            <div key={i} className="menu-heading">
              {item.heading}
            </div>
          );
        }
        return (
          <div key={i} className="menu-item-wrap" onPointerEnter={() => setSub(item.items ? i : null)}>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={item.disabled}
              onClick={() => {
                if (item.items) {
                  setSub(i);
                  return;
                }
                onDone();
                item.onSelect?.();
              }}
            >
              <span className="menu-check">{item.checked ? "✓" : item.icon ?? ""}</span>
              <span className="menu-label">{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
              {item.items && <span className="menu-more">▸</span>}
            </button>
            {item.items && sub === i && <MenuList items={item.items} onDone={onDone} style={{ left: "100%", top: -4 }} />}
          </div>
        );
      })}
    </div>
  );
}
