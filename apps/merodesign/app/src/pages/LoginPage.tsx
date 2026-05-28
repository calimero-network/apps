import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuthStore } from "../store/authStore";
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
      <div className={styles.bgCircle1} />
      <div className={styles.bgCircle2} />
      <div className={styles.bgCircle3} />

      <button className={styles.backBtn} onClick={() => navigate("/")}>
        ← Back
      </button>

      <div className={styles.card}>
        <h1 className={styles.title}>Connect to node</h1>
        <p className={styles.subtitle}>Enter your Calimero node URL.</p>

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
