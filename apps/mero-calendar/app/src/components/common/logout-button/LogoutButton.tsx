import { useMero } from "@calimero-network/mero-react";
import { useNavigate } from "react-router-dom";

import { LogOutIcon } from "../icons/Icons";

/**
 * The one Log out control, at the end of every signed-in top bar.
 *
 * mero-react's `logout()` drops the session's tokens; the route guards would
 * bounce the now-anonymous visitor anyway, but navigating to the landing page
 * here makes that the visible result of the click rather than a side effect.
 *
 * The label collapses to the icon on a phone (see `.mc-logout` in
 * styles/theme.css); the accessible name stays "Log out" either way.
 */
export default function LogoutButton() {
  const { logout } = useMero();
  const navigate = useNavigate();

  const handleLogout = () => {
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
