import {
  Clock,
  FileText,
  Lock,
  LockBox,
  LockStar,
  ShieldCheck,
} from '@calimero-network/mero-icons';

/**
 * The hero's product shot: the vault screen itself, drawn in the app's own
 * language rather than as a screenshot, so it stays crisp and follows the copy.
 * Real labels, the six kinds the app stores, one secret open with its password
 * revealed and a live-looking authenticator code.
 */
const ROWS: [typeof Lock, string, string, string[]][] = [
  [LockBox, 'Company card', 'Payment card', ['billing']],
  [LockStar, 'Deploy key', 'SSH key', ['infra']],
  [Lock, 'GitHub', 'Login', ['work', 'infra']],
  [Clock, 'Stripe', 'Authenticator', ['billing']],
  [FileText, 'Office wifi', 'Secure note', []],
  [ShieldCheck, 'Passport', 'Identity', []],
];

export default function VaultPreview() {
  return (
    <div className="mp-shot" aria-hidden="true">
      <div className="mp-shot__bar">
        <span className="mp-shot__crumb">Acme Ltd</span>
        <span className="mp-shot__sep">/</span>
        <span className="mp-shot__crumb mp-shot__crumb--on">Team vault</span>
        <span className="mp-shot__badge">3 members · E2E</span>
      </div>
      <div className="mp-shot__body">
        <p className="mp-shot__eyebrow">Vault</p>
        <p className="mp-shot__title">Team vault</p>
        <div className="mp-shot__tabs">
          <span className="is-on">Secrets (6)</span>
          <span>Health</span>
          <span>People &amp; devices</span>
          <span>Activity</span>
        </div>
        <ul className="mp-shot__list">
          {ROWS.map(([Icon, name, kind, tags]) => (
            <li
              key={name}
              className={`mp-shot__row ${name === 'GitHub' ? 'is-open' : ''}`}
            >
              <span className="mp-shot__kind">
                <Icon size={14} />
              </span>
              <span className="mp-shot__name">
                {name}
                <small>{kind}</small>
              </span>
              <span className="mp-shot__tags">
                {tags.map((t) => (
                  <em key={t}>{t}</em>
                ))}
                <b>{name === 'GitHub' ? '−' : '+'}</b>
              </span>
              {name === 'GitHub' && (
                <span className="mp-shot__fields">
                  <span>
                    <i>Username</i>
                    <code>ada@acme.example</code>
                  </span>
                  <span>
                    <i>Password</i>
                    <code className="mp-shot__reveal">tr7-Kq2-9xF-vW4</code>
                  </span>
                </span>
              )}
              {name === 'Stripe' && (
                <span className="mp-shot__totp">
                  <code>482 913</code>
                  <i>17s</i>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
