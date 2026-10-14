import { useSignOut } from "../auth/signOut";
import { LogOutIcon } from "./icons";

/**
 * The way out, as a labelled pill: the top bar of the company and audience
 * pickers, and Settings → Your account. Same `signOut` as the sidebar's
 * identity footer, so every exit forgets the open audience too.
 */
export default function LogoutButton({ testId = "logout" }: { testId?: string }) {
  const signOut = useSignOut();
  return (
    <button
      type="button"
      className="logoutPill"
      onClick={signOut}
      data-testid={testId}
      title="Sign out of this node"
    >
      <LogOutIcon size={15} />
      Log out
    </button>
  );
}
