import { CALIMERO_URL, REPO_URL } from "./Landing";
import { PRODUCT } from "./session";

/** The signed-in footer: the way back to the home page, help, your account, legal. */
export function AppFooter({ onShowTips, workspace = true }: { onShowTips?: () => void; workspace?: boolean }) {
  return (
    <footer className="app-footer">
      <div className="app-footer-grid">
        <div className="app-footer-brand">
          <a className="brand" href="#/home">
            <img src="./favicon.svg" alt="" width={20} height={20} />
            <span className="brand-name">{PRODUCT}</span>
          </a>
          <p className="dim">Meeting notes that write themselves, privately.</p>
        </div>
        <nav aria-label="Workspace">
          <h3>Workspace</h3>
          {workspace ? (
            <>
              <a href="#/">Meetings</a>
              <a href="#/actions">Action items</a>
              <a href="#/people">People</a>
            </>
          ) : (
            <a href="#/">Your workspaces</a>
          )}
        </nav>
        <nav aria-label="Help">
          <h3>Help</h3>
          <a href="#/install">Get the extension</a>
          <a href="#/faq">FAQ</a>
          {onShowTips && (
            <button type="button" className="footer-link" onClick={onShowTips}>
              Show getting-started tips
            </button>
          )}
          <a href="#/home">{PRODUCT} home page</a>
        </nav>
        <nav aria-label="Account">
          <h3>Account</h3>
          <a href="#/profile">Profile</a>
          <a href="#/privacy">Privacy</a>
          <a href="#/terms">Terms</a>
        </nav>
      </div>
      <div className="app-footer-base dim">
        <span>
          Built on{" "}
          <a href={CALIMERO_URL} target="_blank" rel="noreferrer">
            Calimero
          </a>
        </span>
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          Source code
        </a>
      </div>
    </footer>
  );
}
