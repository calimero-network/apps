/**
 * Right-click Format menu. Fixed-positioned at (x, y); dismisses on
 * outside-click, Escape, or scroll. One row per format keyword; the active
 * format is check-marked.
 */
import React, { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { C } from '../theme';

const OPTIONS: { label: string; value: string }[] = [
  { label: 'Automatic', value: '' },
  { label: 'Number', value: 'number' },
  { label: 'Currency', value: 'currency' },
  { label: 'Percent', value: 'percent' },
  { label: 'Date', value: 'date' },
];

interface ContextMenuProps {
  x: number;
  y: number;
  activeFormat: string;
  onSelect: (format: string) => void;
  onClose: () => void;
}

export default function ContextMenu({ x, y, activeFormat, onSelect, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return (
    <Menu ref={ref} style={{ left: x, top: y }} role="menu" data-testid="menu-format">
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
    </Menu>
  );
}

const Menu = styled.div`
  position: fixed;
  z-index: 1000;
  min-width: 160px;
  padding: 4px;
  background: ${C.paper};
  border: 1px solid ${C.line};
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
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
