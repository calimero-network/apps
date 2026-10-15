/** Small line icons for the app shell and the team home. Decorative: callers label the control. */
export const IconPlus = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M10 4v12M4 10h12" />
  </svg>
);

export const IconChevron = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 6.5 8 9.5l3-3" />
  </svg>
);

export const IconCheck = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
  </svg>
);

/** The rail toggle: a window with its left pane marked. */
export const IconPanel = () => (
  <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="2.5" y="3.5" width="15" height="13" rx="3" />
    <path d="M8 3.5v13" />
  </svg>
);

export const IconMenu = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
  </svg>
);

export const IconGrid = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="3" y="3" width="5.5" height="5.5" rx="1.5" />
    <rect x="11.5" y="3" width="5.5" height="5.5" rx="1.5" />
    <rect x="3" y="11.5" width="5.5" height="5.5" rx="1.5" />
    <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.5" />
  </svg>
);

export const IconUserPlus = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="7" r="3" />
    <path d="M2.5 16.5c.6-2.8 2.8-4.3 5.5-4.3s4.9 1.5 5.5 4.3M15.5 6v5M13 8.5h5" />
  </svg>
);

export const IconMore = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="10" r="1.5" />
    <circle cx="10" cy="10" r="1.5" />
    <circle cx="15" cy="10" r="1.5" />
  </svg>
);

export const IconSettings = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 6h7M14.5 6h2M3.5 14h2M9.5 14h7" />
    <circle cx="12.5" cy="6" r="2" />
    <circle cx="7.5" cy="14" r="2" />
  </svg>
);

export const IconLogout = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3.5H5A1.5 1.5 0 0 0 3.5 5v10A1.5 1.5 0 0 0 5 16.5h3M12.5 13.5 16 10l-3.5-3.5M16 10H8" />
  </svg>
);

export const IconClose = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M5 5l10 10M15 5 5 15" />
  </svg>
);
