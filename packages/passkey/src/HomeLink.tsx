import { useEffect, useState } from "react";
import { MANAGE_IN_HOME, homeLinkFor, type FindHomeOptions } from "@calimero-apps/connect";

import type { Session } from "./session";

/**
 * The "Manage people in Calimero Home" link for `org` while the session is
 * signed in, else `null` (`homeLinkFor` in `@calimero-apps/connect`): only on
 * a cluster with Home installed, for an owner or admin, or a member of a shared
 * org. Never on a dev server or a static host, so an app runs alone there.
 */
export function useHomeLink(
  session: Session | null | undefined,
  org: string | null | undefined,
  options: FindHomeOptions = {},
): string | null {
  const [href, setHref] = useState<string | null>(null);
  const client = session?.status === "signed-in" ? session.client : null;
  const target = session?.status === "signed-in" ? session.target : null;
  const { href: page, package: pkg } = options;
  useEffect(() => {
    setHref(null);
    if (!client || !org) return;
    let live = true;
    void homeLinkFor(client, target, org, {
      ...(page !== undefined ? { href: page } : {}),
      ...(pkg !== undefined ? { package: pkg } : {}),
    }).then((url) => {
      if (live) setHref(url);
    });
    return () => {
      live = false;
    };
  }, [client, target, org, page, pkg]);
  return href;
}

export interface ManageInHomeLinkProps extends FindHomeOptions {
  /** The app's passkey session (`usePasskeySession(...).session`). */
  session: Session | null | undefined;
  /** The organization the app is in. */
  org: string | null | undefined;
  className?: string;
  /** For a menu: `menuitem`. */
  role?: string;
}

/**
 * "Manage people in Calimero Home →" for an app's account menu: one line in
 * every app, nothing at all where it does not apply ({@link useHomeLink}).
 * Opens Home in its own tab, on the org.
 */
export function ManageInHomeLink({ session, org, className, role, ...options }: ManageInHomeLinkProps) {
  const href = useHomeLink(session, org, options);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? "cp-home-link"}
      role={role}
      data-testid="manage-in-home"
    >
      {MANAGE_IN_HOME}
    </a>
  );
}
