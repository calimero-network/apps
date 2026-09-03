/**
 * The connect step, on its own route.
 *
 * `ConnectButton` (mero-react) owns the whole flow: it renders the button and
 * the modal, which scans DEFAULT_LOCAL_NODE_PORTS for a node that answers,
 * pre-selects the first live one, and otherwise takes a URL it validates
 * against `admin-api/is-authed`. Every app in the fleet uses it; nothing here
 * hand-rolls a node picker.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ConnectButton, useMero } from "@calimero-network/mero-react";
import styles from "./SetupPage.module.css";

export default function LoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useMero();

  // The provider flips this once it has adopted the callback, which is also the
  // desktop hand-off path — so a launcher open lands straight in the forum.
  useEffect(() => {
    if (isAuthenticated) navigate("/f", { replace: true });
  }, [isAuthenticated, navigate]);

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <span className={styles.brand}>
          mero<span>forum</span>
        </span>
        <h1 className={styles.title}>Connect your node</h1>
        <p className={styles.lede}>
          Mero Forum reads and writes a Calimero context on a node you run.
          Connect it and the forum opens — there is no account to make.
        </p>
        <div className={styles.block}>
          <ConnectButton label="Connect a node" />
        </div>
        <button className={styles.secondary} onClick={() => navigate("/")}>
          ← Back
        </button>
      </div>
    </div>
  );
}
