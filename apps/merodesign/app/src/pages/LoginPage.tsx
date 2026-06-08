import { useNavigate } from "react-router-dom";
import { ConnectButton } from "@calimero-network/mero-react";
import Logo from "../components/Logo";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  const navigate = useNavigate();

  return (
    <div className={styles.root}>
      {/* Animated dotted background */}
      <div className={styles.bgDots} />

      {/* Floating blurred gradient circles */}
      <div className={styles.bgCircle1} />
      <div className={styles.bgCircle2} />
      <div className={styles.bgCircle3} />

      {/* Animated canvas-like design elements */}
      <div className={styles.floatEl} style={{ width: 80, height: 56, background: "#2563eb", borderRadius: 8, top: "14%", left: "12%", animationDelay: "0s" }} />
      <div className={styles.floatEl} style={{ width: 56, height: 56, borderRadius: "50%", background: "#7c3aed", top: "20%", right: "15%", animationDelay: "1.2s" }} />
      <div className={styles.floatEl} style={{ width: 100, height: 3, background: "#10b981", top: "72%", left: "8%", animationDelay: "0.6s" }} />
      <div className={styles.floatEl} style={{ width: 48, height: 48, background: "#f97316", borderRadius: 8, bottom: "18%", right: "12%", animationDelay: "2s" }} />
      <div className={styles.floatEl} style={{ width: 70, height: 46, background: "#1e1e1e", border: "2px solid #444", borderRadius: 6, bottom: "22%", left: "14%", animationDelay: "0.9s" }} />
      <div className={styles.floatEl} style={{ width: 90, height: 90, borderRadius: "50%", border: "2px solid #2563eb", top: "50%", right: "8%", animationDelay: "1.6s", background: "transparent" }} />

      <button className={styles.backBtn} onClick={() => navigate("/")}>
        ← Back
      </button>

      <div className={styles.card}>
        <div className={styles.cardLogo}>
          <Logo size={32} />
          <span className={styles.cardLogoText}>MeroDesign</span>
        </div>

        <h1 className={styles.title}>Connect to node</h1>
        <p className={styles.subtitle}>Connect your Calimero node to get started.</p>

        <ConnectButton />
      </div>
    </div>
  );
}
