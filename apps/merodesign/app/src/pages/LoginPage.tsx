import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuthStore } from "../store/authStore";
import Logo from "../components/Logo";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [nodeUrl, setNodeUrl] = useState("http://localhost:2430");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    setError("");
    setLoading(true);
    try {
      const url = nodeUrl.replace(/\/$/, "");
      const res = await axios.post(`${url}/auth/token`, {
        auth_method: "user_password",
        public_key: "admin",
        client_name: "merodesign",
        timestamp: 0,
        permissions: [],
        provider_data: { username: "admin", password: "calimero1234" },
      });
      const { access_token, refresh_token } = res.data?.data ?? res.data;

      const appsRes = await axios.get(`${url}/admin-api/applications`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const applicationId: string = appsRes.data?.data?.apps?.[0]?.id ?? "";

      setAuth(url, access_token, refresh_token, applicationId);
      navigate("/teams");
    } catch {
      setError("Could not connect. Make sure the node is running.");
    } finally {
      setLoading(false);
    }
  }

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
        <p className={styles.subtitle}>Enter your Calimero node URL to get started.</p>

        <label className={styles.label} htmlFor="login-node-url">Node URL</label>
        <input
          id="login-node-url"
          className={styles.input}
          value={nodeUrl}
          onChange={(e) => setNodeUrl(e.target.value)}
          placeholder="http://localhost:2430"
          onKeyDown={(e) => e.key === "Enter" && handleConnect()}
        />

        {error && <p className={styles.error}>{error}</p>}

        <button className={styles.btn} onClick={handleConnect} disabled={loading}>
          {loading ? "Connecting…" : "Connect"}
        </button>
      </div>
    </div>
  );
}
