// Inline SVG icon set mirroring the design mockup. Currentcolor throughout so
// callers control colour via CSS. Kept tiny and prop-less where the mockup uses
// one fixed size.
import React from 'react';

type IconProps = { size?: number };

export function LogoMark(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="20" height="20" rx="5" fill="#0B8FC7" fillOpacity="0.1" stroke="#0B8FC7" strokeOpacity="0.45" />
      <path d="M6 7h10M6 11h10M6 15h6" stroke="#0B8FC7" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
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

const ico = (children: React.ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export function IconDashboard(): React.ReactElement {
  return ico(<><rect x="2" y="2" width="4.5" height="5.5" rx="1" /><rect x="8.5" y="2" width="4.5" height="3" rx="1" /><rect x="8.5" y="7" width="4.5" height="6" rx="1" /><rect x="2" y="9.5" width="4.5" height="3.5" rx="1" /></>);
}

export function IconSales(): React.ReactElement {
  return ico(<><path d="M3.5 1.8h6l2 2v9.4h-8z" /><path d="M5.5 6.5h4M5.5 9h4M5.5 11h2" /></>);
}

export function IconPurchases(): React.ReactElement {
  return ico(<><path d="M2 3h1.6l1.5 7h6.3l1.4-5H4.2" /><circle cx="6" cy="12.3" r="0.9" /><circle cx="10.4" cy="12.3" r="0.9" /></>);
}

export function IconBank(): React.ReactElement {
  return ico(<><path d="M1.8 5.5 7.5 2l5.7 3.5z" /><path d="M3.3 6.5v4.5M6 6.5v4.5M9 6.5v4.5M11.7 6.5v4.5M2 12.8h11" /></>);
}

export function IconContacts(): React.ReactElement {
  return ico(<><circle cx="5.5" cy="5" r="2.2" /><path d="M1.8 12.5c.5-2.2 2-3.3 3.7-3.3s3.2 1.1 3.7 3.3" /><path d="M10 3.2a2 2 0 0 1 0 3.8M11 9.4c1.2.4 2 1.4 2.3 3" /></>);
}

export function IconLedger(): React.ReactElement {
  return ico(<><rect x="2.5" y="1.8" width="10" height="11.4" rx="1.2" /><path d="M7.5 1.8v11.4M4.3 5h1.6M4.3 7.5h1.6M9.2 5h1.6M9.2 7.5h1.6" /></>);
}

export function IconReports(): React.ReactElement {
  return ico(<><path d="M2 13h11" /><rect x="3" y="7.5" width="2" height="4" /><rect x="6.5" y="4.5" width="2" height="7" /><rect x="10" y="2" width="2" height="9.5" /></>);
}

export function IconSettings(): React.ReactElement {
  return ico(<><circle cx="7.5" cy="7.5" r="2" /><path d="M7.5 1.5v1.6M7.5 11.9v1.6M1.5 7.5h1.6M11.9 7.5h1.6M3.3 3.3l1.1 1.1M10.6 10.6l1.1 1.1M3.3 11.7l1.1-1.1M10.6 4.4l1.1-1.1" /></>);
}
