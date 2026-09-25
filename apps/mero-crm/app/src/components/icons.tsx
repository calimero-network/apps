// Inline SVG icon set mirroring the design mockup. Currentcolor throughout so
// callers control colour via CSS. Kept tiny and prop-less where the mockup uses
// one fixed size.
import React from 'react';

type IconProps = { size?: number };

export function LogoMark(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="20" height="20" rx="5" fill="#A5FF3F" fillOpacity="0.12" stroke="#A5FF3F" strokeOpacity="0.4" />
      <path d="M6 15V7l5 4 5-4v8" stroke="#A5FF3F" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronDown({ size = 10 }: IconProps): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconBoard(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="2" y="2.5" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="2.5" width="4" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function IconMembers(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="5.4" cy="5.4" r="2.2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10.4" cy="6" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.8 12c0-1.9 1.6-3.1 3.6-3.1s3.6 1.2 3.6 3.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function IconSearch(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.2 9.2L12 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function IconBack(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M7 3L4 6l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconBang({ size = 9 }: IconProps): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 9 9" fill="none" aria-hidden="true">
      <path d="M4.5 1v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="4.5" cy="7" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function IconAgent(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="1.5" y="3" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 3V1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="4" cy="6" r="0.7" fill="currentColor" />
      <circle cx="8" cy="6" r="0.7" fill="currentColor" />
    </svg>
  );
}

export function IconCopy(): React.ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="8.5" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 3V2a1 1 0 011-1h4.5a1 1 0 011 1v6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconCheck(): React.ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
      <path d="M2 5.5l2.4 2.4L9 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const stroke = { stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function IconDeals(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="5.4" {...stroke} />
      <path d="M9.2 5.6c-.3-.6-1-.9-1.7-.9-1 0-1.7.5-1.7 1.3 0 1.8 3.5.9 3.5 2.7 0 .8-.8 1.3-1.8 1.3-.8 0-1.5-.3-1.8-1M7.5 3.8v7.4" {...stroke} />
    </svg>
  );
}

export function IconActivities(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="2.2" y="3" width="10.6" height="9.8" rx="1.6" {...stroke} />
      <path d="M2.2 6h10.6M5 1.8v2.4M10 1.8v2.4M5.3 9.1l1.4 1.3 2.8-2.8" {...stroke} />
    </svg>
  );
}

export function IconContacts(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="2.4" y="1.8" width="10.2" height="11.4" rx="1.6" {...stroke} />
      <circle cx="7.5" cy="6" r="1.8" {...stroke} />
      <path d="M4.8 10.6c.4-1.3 1.5-2 2.7-2s2.3.7 2.7 2" {...stroke} />
    </svg>
  );
}

export function IconInsights(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M2.5 12.5h10M4 10V7.5M7.5 10V4M11 10V6" {...stroke} />
    </svg>
  );
}

export function IconSettings(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h6M11.5 4.5h1M2.5 10.5h1M6.5 10.5h6" {...stroke} />
      <circle cx="10" cy="4.5" r="1.5" {...stroke} />
      <circle cx="5" cy="10.5" r="1.5" {...stroke} />
    </svg>
  );
}

export function IconSpark(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M7.5 1.8l1.3 3.4 3.4 1.3-3.4 1.3-1.3 3.4-1.3-3.4-3.4-1.3 3.4-1.3zM12 10.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="currentColor" />
    </svg>
  );
}

/** Small glyph per activity kind. */
export function KindIcon({ kind, size = 13 }: { kind: string; size?: number }): React.ReactElement {
  const p: Record<string, React.ReactNode> = {
    call: <path d="M4.2 2.2l1.6.2.8 2.3-1.1.9c.6 1.4 1.6 2.4 3 3l.9-1.1 2.3.8.2 1.6c0 .7-.6 1.3-1.3 1.3C6.3 11.2 3.8 8.7 3 4.4c0-.7.5-2.2 1.2-2.2z" {...stroke} />,
    meeting: <><circle cx="5" cy="5.2" r="1.7" {...stroke} /><circle cx="10.2" cy="5.2" r="1.7" {...stroke} /><path d="M2.2 11.5c.3-1.6 1.4-2.6 2.8-2.6s2.5 1 2.8 2.6M7.4 11.5c.3-1.6 1.4-2.6 2.8-2.6s2.5 1 2.8 2.6" {...stroke} /></>,
    task: <><rect x="2.5" y="2.5" width="10" height="10" rx="2" {...stroke} /><path d="M5 7.6l1.7 1.6L10 5.9" {...stroke} /></>,
    email: <><rect x="2" y="3.5" width="11" height="8" rx="1.4" {...stroke} /><path d="M2.4 4.2l5.1 4 5.1-4" {...stroke} /></>,
    deadline: <><path d="M4 13V2.5M4 2.8h7l-1.6 2.6L11 8H4" {...stroke} /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 15 15" fill="none" aria-hidden="true">
      {p[kind] ?? p.task}
    </svg>
  );
}
