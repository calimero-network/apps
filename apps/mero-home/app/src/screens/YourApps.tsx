import { audience, isAdmin, openLink, otherApps, yourApps, type OrgApp, type OrgView } from "../home";

function AppRow({ app, org, mine }: { app: OrgApp; org: string; mine: boolean }) {
  return (
    <li className="home-app" data-testid={`app-${app.package}`}>
      <div>
        <strong>{app.name}</strong>
        <span className="home-muted">
          {" "}
          · {audience(app)}
          {app.team?.manages ? " · you manage it" : ""}
          {!mine ? " · you are not in it" : ""}
        </span>
      </div>
      {mine && (
        <a className="glass-btn" href={openLink(app.package, org, app.team?.teamId)} data-testid={`open-${app.package}`}>
          Open
        </a>
      )}
    </li>
  );
}

/** "Your apps": the apps of this org the account is in, each with its open link. Admins also see the rest. */
export function YourApps({ view }: { view: OrgView }) {
  const mine = yourApps(view);
  const others = otherApps(view);
  return (
    <section className="home-card" aria-label="Your apps">
      <h2>Your apps</h2>
      {mine.length === 0 ? (
        <p className="home-muted" data-testid="no-apps">
          {isAdmin(view.role)
            ? "You are in no app here yet. Add one on the Admin screen."
            : "No apps yet: ask an admin of this organization to add you to one."}
        </p>
      ) : (
        <ul className="home-list">
          {mine.map((a) => (
            <AppRow key={a.package} app={a} org={view.org} mine />
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <>
          <h3>Other apps in this organization</h3>
          <ul className="home-list" data-testid="other-apps">
            {others.map((a) => (
              <AppRow key={a.package} app={a} org={view.org} mine={false} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
