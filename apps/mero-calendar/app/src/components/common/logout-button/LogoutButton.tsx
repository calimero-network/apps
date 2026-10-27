import { useMero } from "@calimero-apps/cloud";
import { useNavigate } from "react-router-dom";

import { LogOutIcon } from "../icons/Icons";
import { clearLastVisit } from "../../../utils/lastVisit";

/**
 * The one Log out control, at the end of every signed-in top bar.
 *
 * mero-react's `logout()` drops the session's tokens; the route guards would
 * bounce the now-anonymous visitor anyway, but navigating to the landing page
 * here makes that the visible result of the click rather than a side effect.
 *
 * It also forgets the team and calendar open last (utils/lastVisit), so the
 * next sign-in starts at the teams list rather than resuming this session.
 *
 * The label collapses to the icon on a phone (see `.mc-logout` in
 * styles/theme.css); the accessible name stays "Log out" either way.
 */
export default function LogoutButton() {
  const { logout, nodeUrl } = useMero();
  const navigate = useNavigate();

  const handleLogout = () => {
    // Before `logout()`, which drops the node URL the entry is keyed by.
    clearLastVisit(nodeUrl);
    logout();
    navigate("/", { replace: true });
  };

  return (
    <button
      type="button"
      className="mc-logout"
      onClick={handleLogout}
      title="Log out"
      aria-label="Log out"
      data-testid="logout-btn"
    >
      <LogOutIcon size={17} />
      <span className="mc-logout__label">Log out</span>
    </button>
  );
}
