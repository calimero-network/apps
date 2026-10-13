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

export function IconAllIssues(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="11" height="1.6" rx="0.8" fill="currentColor" />
      <rect x="2" y="6.7" width="11" height="1.6" rx="0.8" fill="currentColor" />
      <rect x="2" y="10.4" width="11" height="1.6" rx="0.8" fill="currentColor" />
    </svg>
  );
}

export function IconMyIssues(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="7.5" cy="5" r="2.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.6 12.4c0-2.4 2.2-4 4.9-4s4.9 1.6 4.9 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
