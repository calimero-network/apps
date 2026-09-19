import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCalimero } from '../../lib/useCalimero';
import { AgreementService } from '../../api/agreementService';
import { redeemInvitation } from '../../api/invitationJoin';
import type { Agreement } from '../../api/clientApi';
import { AppHeader } from '../../components/AppHeader';
import styles from './AgreementsPage.module.css';

// ── The agreements list ──────────────────────────────────────────────────────
//
// mero-design's Teams screen, in its own CSS (copied verbatim — see the note at
// the foot of the stylesheet).
//
// ── On the noun ─────────────────────────────────────────────────────────────
//
// "Spaces" is gone and was never going to fit here. The brief suggested
// Teams/Projects; this app has no room for that pair, and inventing it would
// have meant naming a level that does not exist.
//
// MeroSign's SDK (`@calimero-network/calimero-client`) has no namespace surface
// at all — no `createNamespace`, no subgroups. One AGREEMENT is one context, and
// the context is what you invite people to. So the two nouns are:
//
//   AGREEMENT — the thing you invite people to. This screen.
//   DOCUMENT  — the thing that gets signed, inside one. The next screen.
//
// Which is also how a person describes it: you are invited to an agreement, and
// you sign the documents in it.

export default function AgreementsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { app } = useCalimero();

  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const service = useMemo(() => new AgreementService(app), [app]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await service.listAgreements();
      if (res.error) {
        setError(res.error.message);
        setAgreements([]);
        return;
      }
      const rows = res.data || [];
      setAgreements(rows);

      // Then replace the locally-recorded names with the ones the agreements'
      // own contracts hold. Those are the replicated values, so they are the
      // same string on every node — this is what makes the creator's "NDA with
      // Acme" show up as "NDA with Acme" for the people they invited.
      try {
        const named = await service.resolveSharedNames(rows);
        setAgreements((cur) => (cur === rows ? named : cur));
      } catch {
        /* the painted list stands */
      }
    } catch {
      setError('Could not load your agreements.');
      setAgreements([]);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    if (app) void load();
    // `location.key` so returning here after a join reloads the list without a
    // full page reload, which is what the old flow used.
  }, [app, load, location.key]);

  // Close the card menu on an outside click, as mero-design does.
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const res = await service.createAgreement(name);
      if (res.error) {
        setError(res.error.message);
        return;
      }
      setNewName('');
      await load();
    } finally {
      setCreating(false);
    }
  }, [newName, service, load]);

  const join = useCallback(async () => {
    const raw = joinCode.trim();
    if (!raw) return;
    setJoining(true);
    setJoinError('');
    try {
      const result = await redeemInvitation(raw, app);
      setJoinCode('');
      navigate(`/agreements/${result.contextId}`);
    } catch (err) {
      setJoinError(
        err instanceof Error ? err.message : 'Could not join that agreement.',
      );
    } finally {
      setJoining(false);
    }
  }, [joinCode, app, navigate]);

  const open = useCallback(
    (a: Agreement) => {
      // The agreement screens still read these two out of storage; the route
      // param is the source of truth and this keeps them in step.
      localStorage.setItem('agreementContextID', a.contextId);
      localStorage.setItem('agreementContextUserID', a.sharedIdentity);
      navigate(`/agreements/${a.contextId}`);
    },
    [navigate],
  );

  return (
    <div className={styles.root}>
      <AppHeader />

      <main className={styles.main}>
        <h1 className={styles.title}>Your agreements</h1>
        <p className={styles.subtitle}>
          An agreement holds the documents a group of people sign. Everything in
          one lives on the nodes of the people invited to it.
        </p>

        {error && (
          <p className={styles.error} data-testid="list-error">
            {error}
          </p>
        )}

        <div className={styles.createRow}>
          <input
            className={styles.input}
            placeholder="New agreement name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            data-testid="new-agreement-name"
          />
          <button
            className={styles.btn}
            onClick={() => void create()}
            disabled={creating || !newName.trim()}
            data-testid="create-agreement"
          >
            {creating ? <span className={styles.spinner} /> : null}
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>

        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : error ? null /* the error above already says why the list is empty;
                            "No agreements yet. Create one above" underneath it
                            contradicts it */ : agreements.length === 0 ? (
          <p className={styles.empty} data-testid="agreements-empty">
            No agreements yet. Create one above, or paste an invitation below.
          </p>
        ) : (
          <div className={styles.grid} data-testid="agreements-grid">
            {agreements.map((a) => (
              <div
                key={a.contextId}
                className={styles.cardWrap}
                ref={menuOpenId === a.contextId ? menuRef : null}
                data-testid="agreement-card"
              >
                <button className={styles.card} onClick={() => open(a)}>
                  <span className={styles.cardName}>{a.name}</span>
                  <span className={styles.cardSub}>
                    {a.role?.trim() ? a.role : 'Agreement'}
                  </span>
                </button>
                <button
                  className={styles.menuBtn}
                  title="More options"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(
                      menuOpenId === a.contextId ? null : a.contextId,
                    );
                  }}
                >
                  ⋯
                </button>
                {menuOpenId === a.contextId && (
                  <div className={styles.dropdown}>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => {
                        setMenuOpenId(null);
                        open(a);
                      }}
                    >
                      Open
                    </button>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => {
                        setMenuOpenId(null);
                        void navigator.clipboard.writeText(a.contextId);
                      }}
                    >
                      Copy id
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className={styles.joinSection}>
          <p className={styles.joinLabel}>
            Got an invitation? Join an agreement.
          </p>
          <div className={styles.joinRow}>
            <input
              className={styles.input}
              placeholder="Paste the link or code you were sent…"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void join()}
              data-testid="join-code"
            />
            <button
              className={styles.btn}
              onClick={() => void join()}
              disabled={joining || !joinCode.trim()}
              data-testid="join-agreement"
            >
              {joining ? <span className={styles.spinner} /> : null}
              {joining ? 'Joining…' : 'Join'}
            </button>
          </div>
          <p className={styles.hint}>
            Opening the link works too — you only need this if it arrived as
            text. The agreement keeps the name its creator gave it.
          </p>
          {joinError && <p className={styles.joinError}>{joinError}</p>}
        </div>

        <div className={styles.joinSection}>
          <p className={styles.joinLabel}>Your signatures</p>
          <div className={styles.joinRow}>
            <button
              className={styles.btnGhost}
              onClick={() => navigate('/signatures')}
              data-testid="go-signatures"
            >
              Open signature library
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
