/**
 * Right-click cell menu. Fixed-positioned at (x, y); dismisses on
 * outside-click, Escape, or scroll. One row per format keyword (the active one
 * check-marked), then the structural actions the page passes in: inserting and
 * deleting rows and columns, naming the selection.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { C } from '../theme';

const OPTIONS: { label: string; value: string }[] = [
  { label: 'Automatic', value: '' },
  { label: 'Number', value: 'number' },
  { label: 'Currency', value: 'currency' },
  { label: 'Percent', value: 'percent' },
  { label: 'Date', value: 'date' },
];

/** One action row; `testId` becomes `action-<testId>`. */
export interface MenuAction {
  label: string;
  testId: string;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  activeFormat: string;
  onSelect: (format: string) => void;
  /** Groups of actions, each under its own label. */
  sections: { label: string; actions: MenuAction[] }[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, activeFormat, onSelect, sections, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Opened near the bottom or right edge, the menu moves up or left to fit;
  // taller than the window, it scrolls.
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    // Scrolling the page closes the menu; scrolling the menu itself does not.
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  return (
    <Menu ref={ref} style={pos} role="menu" data-testid="menu-format">
      <MenuLabel>Format</MenuLabel>
      {OPTIONS.map((o) => (
        <MenuItem
          key={o.value}
          role="menuitemradio"
          aria-checked={activeFormat === o.value}
          data-testid={`action-format_${o.value || 'automatic'}`}
          onClick={() => onSelect(o.value)}
        >
          <Check>{activeFormat === o.value ? '✓' : ''}</Check>
          {o.label}
        </MenuItem>
      ))}
      {sections.map((section) => (
        <React.Fragment key={section.label}>
          <Divider />
          <MenuLabel>{section.label}</MenuLabel>
          {section.actions.map((a) => (
            <MenuItem key={a.testId} role="menuitem" data-testid={`action-${a.testId}`} onClick={a.onClick}>
              <Check />
              {a.label}
            </MenuItem>
          ))}
        </React.Fragment>
      ))}
    </Menu>
  );
}

const Menu = styled.div`
  position: fixed;
  z-index: 1000;
  min-width: 160px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 4px;
  background: ${C.paper};
  border: 1px solid ${C.line};
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
`;

const Divider = styled.div`
  height: 1px;
  margin: 4px 6px;
  background: ${C.line};
`;

const MenuLabel = styled.div`
  padding: 4px 10px 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: ${C.mutedSoft};
`;

const MenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
  color: ${C.ink};
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  &:hover { background: ${C.paper2}; }
`;

const Check = styled.span`
  width: 12px;
  color: ${C.green};
  flex-shrink: 0;
`;
