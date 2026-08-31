import { useNavigate } from "react-router-dom";
import { ConnectButton } from "@calimero-network/mero-react";
import CalendarLogo from "../../components/common/logo/CalendarLogo";
import ThemeToggle from "../../components/common/theme-toggle/ThemeToggle";
import styles from "./login.module.scss";

// rc.8 login: a single <ConnectButton /> drives the node auth flow. The button
// redirects to the node's /auth/login and MeroProvider consumes the callback
// hash itself — no manual node-url / context / identity wizard anymore.
export const LoginPage = () => {
  const navigate = useNavigate();

  return (
    <div className={styles.root}>
      <div className={styles.bgCircle1} />
      <div className={styles.bgCircle2} />

      <button className={styles.backBtn} onClick={() => navigate("/")}>
        ← Back
      </button>
      <div className={styles.themeSlot}>
        <ThemeToggle />
      </div>

      <div className={styles.card} data-testid="login-connect">
        <div className={styles.cardLogo}>
          <CalendarLogo size={32} color="var(--accent)" />
          <span className={styles.cardLogoText}>Mero Calendar</span>
        </div>

        <h1 className={styles.title}>Connect to node</h1>
        <p className={styles.subtitle}>
          Connect your Calimero node to open your shared calendars.
        </p>

        <div className={styles.connectWrap}>
          <ConnectButton />
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
