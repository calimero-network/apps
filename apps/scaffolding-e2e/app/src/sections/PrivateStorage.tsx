import { useState } from "react";
import * as api from "../api/kvStore";

function ResultBox({ result }: { result: unknown }) {
  if (result === undefined) return null;
  const isError =
    result !== null &&
    typeof result === "object" &&
    "error" in result &&
    (result as { error: unknown }).error !== null;
  return (
    <pre className={`result-box${isError ? " error" : ""}`}>
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

function useCall() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);
  async function run(fn: () => Promise<unknown>) {
    setLoading(true);
    try {
      setResult(await fn());
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }
  return { loading, result, run };
}

export function PrivateStorage() {
  const [gameId, setGameId] = useState("");
  const [secret, setSecret] = useState("");
  const [guessGameId, setGuessGameId] = useState("");
  const [guess, setGuess] = useState("");

  const addSecretCall = useCall();
  const addGuessCall = useCall();
  const mySecretsCall = useCall();
  const gamesCall = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Private Storage</h2>
        <p className="section-desc">
          Node-local secrets that are NOT replicated to peers. Useful for
          commit-reveal schemes (e.g., games). The hash is shared; the secret
          stays local.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">add_secret(game_id, secret)</div>
          <p
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              marginBottom: 10,
            }}
          >
            Stores secret privately. Emits the hash publicly so others can
            verify later.
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="game_id"
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="secret"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={addSecretCall.loading}
            onClick={() =>
              addSecretCall.run(() => api.addSecret(gameId, secret))
            }
          >
            {addSecretCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={addSecretCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">add_guess(game_id, guess) → bool</div>
          <p
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              marginBottom: 10,
            }}
          >
            Verifies guess against the stored hash. Returns true if correct.
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="game_id"
              value={guessGameId}
              onChange={(e) => setGuessGameId(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="guess"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={addGuessCall.loading}
            onClick={() =>
              addGuessCall.run(() => api.addGuess(guessGameId, guess))
            }
          >
            {addGuessCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={addGuessCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">my_secrets() / games()</div>
          <p
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              marginBottom: 10,
            }}
          >
            <code>my_secrets</code> — private, node-local only.{" "}
            <code>games</code> — public hashes, replicated.
          </p>
          <div className="input-row">
            <button
              className="btn-calimero-outline"
              disabled={mySecretsCall.loading}
              onClick={() => mySecretsCall.run(() => api.mySecrets())}
            >
              {mySecretsCall.loading ? "..." : "my_secrets"}
            </button>
            <button
              className="btn-calimero-outline"
              disabled={gamesCall.loading}
              onClick={() => gamesCall.run(() => api.games())}
            >
              {gamesCall.loading ? "..." : "games"}
            </button>
          </div>
          <ResultBox result={mySecretsCall.result} />
          <ResultBox result={gamesCall.result} />
        </div>
      </div>
    </div>
  );
}
