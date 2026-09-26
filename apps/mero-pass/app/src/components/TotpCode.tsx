import { useEffect, useState } from 'react';

import { copySecret } from '../lib/clipboard';
import { parseTotp, secondsRemaining, totpCode } from '../lib/totp';
import styles from '../pages/vault/vault.module.css';

/** A live authenticator code with its countdown, computed in the browser. */
export default function TotpCode({ seed }: { seed: string }) {
  const params = parseTotp(seed);
  const [code, setCode] = useState<string | null>(null);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (!params) return;
    let cancelled = false;
    const tick = async () => {
      const c = await totpCode(params);
      if (cancelled) return;
      setCode(c);
      setLeft(secondsRemaining(params.period));
    };
    void tick();
    const t = setInterval(() => void tick(), 1_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // `seed` is the identity of the params; re-parsing each render is cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  if (!params) {
    return (
      <span className={styles.fieldValue}>Not a valid authenticator seed</span>
    );
  }
  const grouped = code
    ? `${code.slice(0, code.length / 2)} ${code.slice(code.length / 2)}`
    : '…';
  return (
    <span className={styles.totp} data-testid="totp-code">
      <span className={styles.totpDigits}>{grouped}</span>
      <span className={styles.totpLeft} aria-label={`${left} seconds left`}>
        {left}s
      </span>
      <button
        type="button"
        className={styles.mini}
        onClick={() => code && void copySecret(code, params.period * 1000)}
      >
        Copy
      </button>
    </span>
  );
}
