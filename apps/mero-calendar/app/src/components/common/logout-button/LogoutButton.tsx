import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { targetKey } from "@calimero-apps/connect";
import { ManageInHomeLink } from "@calimero-apps/passkey";

import { useSessionApi } from "../../../api/sessionContext";
import { LogOutIcon } from "../icons/Icons";
import { clearLastVisit } from "../../../utils/lastVisit";

/**
 * Ends the session: signs out on the cluster, forgets the stored session, and
 * returns to the landing page. It also forgets the team and calendar open last
 * (utils/lastVisit), so the next person at this browser does not land in them.
 *
 * Before it, on a team's screens, "Manage people in Calimero Home"
 * (`ManageInHomeLink`) for that team's organization, where it applies.
 */
export default function LogoutButton() {
  const { api } = useSessionApi();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const team = matchPath("/teams/:teamId/*", pathname)?.params.teamId ?? null;

  const handleLogout = async () => {
    if (api.session.status === "signed-in") clearLastVisit(targetKey(api.session.target));
    await api.signOut();
    navigate("/", { replace: true });
  };

  return (
    <>
      <ManageInHomeLink session={api.session} org={team} className="mc-home-link" />
      <button
        type="button"
        className="mc-logout"
        onClick={() => void handleLogout()}
        title="Log out"
        aria-label="Log out"
        data-testid="logout-btn"
      >
        <LogOutIcon size={17} />
        <span className="mc-logout__label">Log out</span>
      </button>
    </>
  );
}
