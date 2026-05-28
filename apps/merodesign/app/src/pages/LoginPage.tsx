import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuthStore } from "../store/authStore";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [nodeUrl, setNodeUrl] = useState("http://localhost:2430");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    setError("");
    setLoading(true);
    try {
      const url = nodeUrl.replace(/\/$/, "");
      const res = await axios.post(`${url}/auth/token`, {
        auth_method: "user_password",
        public_key: username,
        client_name: "merodesign",
        timestamp: 0,
        permissions: [],
        provider_data: { username, password },
      });
      const { access_token, refresh_token } = res.data?.data ?? res.data;
      setAuth(url, access_token, refresh_token);
      navigate("/teams");
    } catch {
      setError("Connection failed. Check node URL and credentials.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <h1 className={styles.title}>Connect to node</h1>
        <p className={styles.subtitle}>Enter your Calimero node URL and credentials.</p>

        <label className={styles.label} htmlFor="login-node-url">Node URL</label>
        <input
          id="login-node-url"
          className={styles.input}
          value={nodeUrl}
          onChange={(e) => setNodeUrl(e.target.value)}
          placeholder="http://localhost:2430"
        />

        <label className={styles.label} htmlFor="login-username">Username</label>
        <input
          id="login-username"
          className={styles.input}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <label className={styles.label} htmlFor="login-password">Password</label>
        <input
          id="login-password"
          className={styles.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
