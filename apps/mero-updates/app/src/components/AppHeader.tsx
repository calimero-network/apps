import { Fragment, type ReactNode } from "react";

import { ChevronRightIcon } from "./icons";

export interface Crumb {
  label: string;
  /** Present when the crumb navigates somewhere; the last crumb usually has none. */
  onClick?: () => void;
  icon?: ReactNode;
  testId?: string;
}

/**
 * The sticky top bar every signed-in screen shares: brand, breadcrumb, and a
 * right-hand slot for status and session controls. Presentation only — each
 * page passes its own crumbs and actions.
 *
 * The brand is deliberately NOT a link: its text contains "Updates", and the
 * section nav's "Updates" link is found by name in the e2e suites.
 */
export default function AppHeader({ crumbs, right }: { crumbs: Crumb[]; right?: ReactNode }) {
  return (
    <header className="appHeader">
      <div className="appHeaderInner">
        <span className="brand">
          <span className="brandMark" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 18V6l8 7 8-7v12" />
            </svg>
          </span>
          <span className="brandName">Mero Updates</span>
        </span>
        {crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <Fragment key={`${c.label}-${i}`}>
                <ChevronRightIcon size={14} className="crumbSep" />
                {c.onClick ? (
                  <button type="button" className="crumb" onClick={c.onClick} data-testid={c.testId}>
                    {c.icon}
                    <span className="crumbLabel">{c.label}</span>
                  </button>
                ) : (
                  <span className="crumb current" aria-current="page" data-testid={c.testId}>
                    {c.icon}
                    <span className="crumbLabel">{c.label}</span>
                  </span>
                )}
              </Fragment>
            ))}
          </nav>
        )}
        <div className="grow" />
        {right && <div className="appHeaderRight">{right}</div>}
      </div>
    </header>
  );
}
