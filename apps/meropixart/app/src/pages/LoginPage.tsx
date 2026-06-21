import { useNavigate } from "react-router-dom";
import { ConnectButton } from "@calimero-network/mero-react";
import Logo from "../components/Logo";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  const navigate = useNavigate();

  return (
    <div className={styles.root}>
      {/* Dotted background overlay */}
      <div className={styles.bgDots} />

      {/* Floating blurred gradient glows */}
      <div className={styles.bgCircle1} />
      <div className={styles.bgCircle2} />
      <div className={styles.bgCircle3} />

      {/* Floating editor-element shapes */}
      <div className={styles.floatEl} style={{ width: 84, height: 60, background: "linear-gradient(135deg,#2563eb,#b03a8a)", borderRadius: 8, top: "14%", left: "12%", animationDelay: "0s" }} />
      <div className={styles.floatEl} style={{ width: 56, height: 56, borderRadius: "50%", background: "radial-gradient(circle at 30% 30%,#ffd27d,#8a6cff)", top: "20%", right: "15%", animationDelay: "1.2s" }} />
      <div className={styles.floatEl} style={{ width: 100, height: 4, background: "var(--accent)", top: "72%", left: "8%", animationDelay: "0.6s" }} />
      <div className={styles.floatEl} style={{ width: 48, height: 48, background: "#3aa0ff", borderRadius: 8, bottom: "18%", right: "12%", animationDelay: "2s" }} />
      <div className={styles.floatEl + " mp-checkerboard"} style={{ width: 70, height: 50, borderRadius: 6, bottom: "22%", left: "14%", animationDelay: "0.9s" }} />
      <div className={styles.floatEl} style={{ width: 90, height: 90, borderRadius: "50%", border: "2px solid var(--accent)", top: "50%", right: "8%", animationDelay: "1.6s", background: "transparent" }} />

      <button className={styles.backBtn} onClick={() => navigate("/")}>
        ← Back
      </button>

      <div className={styles.card}>
        <div className={styles.cardLogo}>
          <Logo size={32} />
          <span className={styles.cardLogoText}>MeroPixArt</span>
        </div>

        <h1 className={styles.title}>Connect to node</h1>
        <p className={styles.subtitle}>Connect your Calimero node to open the editor.</p>

        <div className={styles.connectWrap}>
          <ConnectButton />
        </div>
      </div>
    </div>
  );
}
