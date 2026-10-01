import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t, HEALTH_COLOR } from '../../theme';
import { APP_ROUTE } from '../../config';
import LostReasonModal from '../../components/LostReasonModal';
import { KindIcon, IconSpark, IconCopy } from '../../components/icons';
import {
  Button, Chip, DueChip, Empty, Input, Label, Money, Page, Panel, Row, Select, StatusBadge, TextArea, copyText,
} from '../../components/ui';
import {
  ACTIVITY_KINDS, ACTIVITY_LABEL, buildAssistantPrompt, dealHealth, draftFollowUpEmail, dueInDays,
  formatMoney, fromDateInput, nextBestActions, parseMoney, toDateInput, type NextAction,
} from '../../utils/crm';
import { describeError } from '../../utils/errors';
import { formatDate, relativeTime } from '../../utils/display';
import type { DealDetail } from '../../hooks/useCrm';
import { useAppCtx } from './appContext';

interface Form {
  title: string;
  value: string;
  organization: string;
  contactId: string;
  owner: string;
  close: string;
  source: string;
}

function formOf(d: DealDetail['deal']): Form {
  return {
    title: d.title,
    value: String(d.value),
    organization: d.organization,
    contactId: d.contact_id ?? '',
    owner: d.owner ?? '',
    close: toDateInput(d.expected_close),
    source: d.source,
  };
}

export default function DealDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const { data, currentUser, myName, ownerOptions } = useAppCtx();
  const navigate = useNavigate();
  const toast = useToast();
  const [detail, setDetail] = useState<DealDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [losing, setLosing] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  const { currency, rotting_days: rottingDays } = data.settings;

  // Re-read whenever the pipeline snapshot changes, so a teammate's edit lands
  // here too. The form keeps the user's unsaved edits rather than clobbering them.
  useEffect(() => {
    let cancelled = false;
    if (!data.ready || !id) return;
    data.getDeal(id)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setMissing(false);
        setForm((f) => (f && dirty ? f : formOf(d.deal)));
      })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, data.ready, data.version]);

  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.show({ variant: 'success', description: ok });
    } catch (err) {
      toast.show({ variant: 'error', description: describeError(err) });
    }
  }, [toast]);

  const now = Date.now();
  const health = useMemo(() => (detail ? dealHealth(detail.deal, rottingDays, now) : null), [detail, rottingDays, now]);
  const actions = useMemo(
    () => (detail ? nextBestActions(detail.deal, data.stages, rottingDays, now) : []),
    [detail, data.stages, rottingDays, now],
  );

  if (missing) {
    return (
      <Empty>
        <strong>This deal no longer exists</strong>
        It may have been deleted by its creator. <a href={APP_ROUTE} onClick={(e) => { e.preventDefault(); navigate(APP_ROUTE); }} style={{ color: t.color.accent }}>Back to the pipeline</a>
      </Empty>
    );
  }
  if (!detail || !form || !health) return <Empty>Loading deal…</Empty>;

  const { deal, contact, activities, notes } = detail;
  const isOpen = deal.status === 'open';
  const stageIdx = data.stages.findIndex((s) => s.id === deal.stage_id);
  const set = (patch: Partial<Form>) => { setForm({ ...form, ...patch }); setDirty(true); };
  const parsedValue = parseMoney(form.value);

  const save = () => run(async () => {
    if (parsedValue === null) throw new Error('Value must be a number, e.g. 12000 or 12k');
    await data.act((c) => c.updateDeal({
      deal_id: deal.id,
      title: form.title,
      value: parsedValue,
      organization: form.organization,
      contact_id: form.contactId || null,
      owner: form.owner || null,
      expected_close: fromDateInput(form.close),
      source: form.source,
    }));
    setDirty(false);
  }, 'Deal saved');

  const schedule = (kind: string, subject: string, due: number, note = '') => run(
    () => data.act((c) => c.addActivity({
      deal_id: deal.id, contact_id: deal.contact_id, kind, subject, due_at: due, owner: deal.owner ?? (myName || null), note,
    })),
    `Scheduled: ${subject}`,
  );

  const onAction = (a: NextAction) => {
    if (a.activity) {
      void schedule(a.activity.kind, a.activity.subject, dueInDays(a.activity.dueInDays, now));
    } else if (a.field) {
      const el = fieldRefs.current[a.field];
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    }
  };

  const email = draftFollowUpEmail(deal, data.stages, contact ?? null, myName);

  return (
    <Page>
      <Header>
        <div className="left">
          <Row $gap={10}>
            <h1 data-testid="deal-title">{deal.title}</h1>
            <StatusBadge status={deal.status} />
          </Row>
          <div className="sub">
            <strong><Money value={deal.value} currency={currency} /></strong>
            {deal.organization && <> · {deal.organization}</>}
            {deal.contact_name && <> · {deal.contact_name}</>}
            {deal.owner && <> · owned by {deal.owner}</>}
            {deal.status === 'lost' && deal.lost_reason && <> · lost: {deal.lost_reason}</>}
          </div>
        </div>
        <Row $gap={8}>
          {isOpen ? (
            <>
              <Button $variant="won" data-testid="mark-won" onClick={() => run(() => data.act((c) => c.markWon({ deal_id: deal.id })), `Won — ${formatMoney(deal.value, currency)}`)}>Won</Button>
              <Button $variant="lost" data-testid="mark-lost" onClick={() => setLosing(true)}>Lost</Button>
            </>
          ) : (
            <Button data-testid="reopen-deal" onClick={() => run(() => data.act((c) => c.reopenDeal({ deal_id: deal.id })), 'Deal reopened')}>Reopen</Button>
          )}
          {deal.created_by === currentUser && (
            <Button
              $variant="danger"
              data-testid="delete-deal"
              onClick={() => {
                if (!window.confirm(`Delete “${deal.title}” with its activities and notes? This cannot be undone.`)) return;
                void run(async () => {
                  await data.act((c) => c.deleteDeal({ deal_id: deal.id }));
                  navigate(APP_ROUTE);
                }, 'Deal deleted');
              }}
            >Delete</Button>
          )}
        </Row>
      </Header>

      <Stepper aria-label="Stage">
        {data.stages.map((s, i) => (
          <button
            key={s.id}
            data-testid="stage-step"
            data-stage-id={s.id}
            className={`${i < stageIdx ? 'past' : ''} ${i === stageIdx ? 'current' : ''}`}
            disabled={!isOpen || i === stageIdx}
            title={isOpen ? `Move to ${s.name} (${s.probability}%)` : 'Reopen the deal to move it'}
            onClick={() => run(() => data.act((c) => c.moveDeal({ deal_id: deal.id, stage_id: s.id })))}
          >
            {s.name}
          </button>
        ))}
      </Stepper>
      {isOpen && (
        <div style={{ fontSize: 11.5, color: t.color.text3, marginTop: -8 }}>
          In this stage for {Math.max(0, Math.round((now - deal.stage_entered_at) / 86_400_000))} days
        </div>
      )}

      <Grid>
        <div className="col">
          <Panel>
            <h3>Details</h3>
            <div className="form">
              <Label>Title<Input value={form.title} onChange={(e) => set({ title: e.target.value })} data-testid="edit-title" /></Label>
              <Label>Value ({currency})<Input value={form.value} inputMode="decimal" onChange={(e) => set({ value: e.target.value })} aria-invalid={parsedValue === null} data-testid="edit-value" /></Label>
              <Label>Organization<Input value={form.organization} onChange={(e) => set({ organization: e.target.value })} /></Label>
              <Label>
                Contact person
                <Select ref={(el) => { fieldRefs.current.contact = el; }} value={form.contactId} onChange={(e) => set({ contactId: e.target.value })} data-testid="edit-contact">
                  <option value="">— None —</option>
                  {data.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.organization ? ` · ${c.organization}` : ''}</option>)}
                </Select>
              </Label>
              <Label>
                Owner
                <Select ref={(el) => { fieldRefs.current.owner = el; }} value={form.owner} onChange={(e) => set({ owner: e.target.value })}>
                  <option value="">— Unassigned —</option>
                  {ownerOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              </Label>
              <Label>
                Expected close
                <Input ref={(el) => { fieldRefs.current.expected_close = el; }} type="date" value={form.close} onChange={(e) => set({ close: e.target.value })} data-testid="edit-close" />
              </Label>
              <Label>Source<Input value={form.source} onChange={(e) => set({ source: e.target.value })} placeholder="Referral, inbound…" /></Label>
            </div>
            {dirty && (
              <Row $gap={8} style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                <Button onClick={() => { setForm(formOf(deal)); setDirty(false); }}>Discard</Button>
                <Button $variant="primary" data-testid="save-deal" disabled={!form.title.trim() || parsedValue === null} onClick={() => void save()}>Save</Button>
              </Row>
            )}
            <div className="facts">
              Added {formatDate(deal.created_at)}
              {deal.closed_at && <> · closed {formatDate(deal.closed_at)}</>}
            </div>
          </Panel>

          {contact && (
            <Panel data-testid="deal-contact-card">
              <h3>Person</h3>
              <div style={{ fontWeight: 600 }}>{contact.name}</div>
              <div className="muted">{[contact.job_title, contact.organization].filter(Boolean).join(' at ')}</div>
              {contact.email && <div><a href={`mailto:${contact.email}`} className="link">{contact.email}</a></div>}
              {contact.phone && <div><a href={`tel:${contact.phone}`} className="link">{contact.phone}</a></div>}
            </Panel>
          )}
        </div>

        <div className="col wide">
          <Panel data-testid="assistant-panel">
            <h3><IconSpark /> Deal assistant</h3>
            {isOpen ? (
              <>
                <HealthRow>
                  <div className="gauge" style={{ ['--c' as string]: HEALTH_COLOR[health.level], ['--p' as string]: `${health.score}%` }}>
                    <span data-testid="health-score">{health.score}</span>
                  </div>
                  <div>
                    <div className="lvl" style={{ color: HEALTH_COLOR[health.level] }}>
                      {health.level === 'healthy' ? 'On track' : health.level === 'at-risk' ? 'Needs attention' : 'At risk of slipping'}
                    </div>
                    <div className="muted">
                      Win likelihood ~{health.winLikelihood}% (stage {deal.probability}%, adjusted for health)
                    </div>
                    {health.reasons.length > 0 && (
                      <ul className="reasons">{health.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    )}
                  </div>
                </HealthRow>
                {actions.length > 0 && (
                  <div className="actions">
                    <div className="label">Suggested next steps</div>
                    {actions.map((a) => (
                      <Suggestion key={a.id} data-testid="suggestion">
                        <div>
                          <div className="t">{a.activity && <KindIcon kind={a.activity.kind} />} {a.title}</div>
                          <div className="why">{a.why}</div>
                        </div>
                        <Button $small $variant={a.activity ? 'primary' : 'ghost'} onClick={() => onAction(a)} data-testid={`suggestion-${a.id}`}>
                          {a.activity ? (a.activity.dueInDays === 0 ? 'Schedule today' : `Schedule in ${a.activity.dueInDays}d`) : 'Fix'}
                        </Button>
                      </Suggestion>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="muted">
                {deal.status === 'won' ? 'Closed won. Nice work.' : 'Closed lost. Reopen it if the conversation comes back.'}
              </div>
            )}
            <Row $gap={8} $wrap style={{ marginTop: 14 }}>
              <Button $small onClick={() => setShowEmail((v) => !v)} data-testid="draft-email-btn">
                {showEmail ? 'Hide email draft' : 'Draft follow-up email'}
              </Button>
              <Button
                $small
                data-testid="copy-ai-prompt"
                title="Copies the deal's full context as a prompt for your AI assistant"
                onClick={async () => {
                  const ok = await copyText(buildAssistantPrompt(detail, data.stages, currency, rottingDays, now));
                  toast.show({ variant: ok ? 'success' : 'error', description: ok ? 'Prompt copied — paste it into your AI assistant' : 'Clipboard unavailable' });
                }}
              ><IconCopy /> Copy AI coaching prompt</Button>
            </Row>
            {showEmail && (
              <EmailBox data-testid="email-draft">
                <div className="subj"><span>Subject</span> {email.subject}</div>
                <pre>{email.body}</pre>
                <Row $gap={8}>
                  <Button $small onClick={async () => {
                    const ok = await copyText(`Subject: ${email.subject}\n\n${email.body}`);
                    toast.show({ variant: ok ? 'success' : 'error', description: ok ? 'Email copied' : 'Clipboard unavailable' });
                  }}>Copy</Button>
                  {contact?.email && (
                    <a
                      className="mail"
                      href={`mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`}
                    >Open in mail app</a>
                  )}
                  <Button $small onClick={() => void schedule('email', email.subject, dueInDays(0, now), email.body)}>Log as email activity</Button>
                </Row>
              </EmailBox>
            )}
          </Panel>

          <Panel>
            <h3>Activities <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>{activities.filter((a) => !a.done).length} open</span></h3>
            <ScheduleForm onSchedule={(kind, subject, due) => schedule(kind, subject, due)} />
            <List>
              {activities.length === 0 && <div className="muted" style={{ padding: '8px 0' }}>Nothing scheduled yet.</div>}
              {activities.map((a) => (
                <li key={a.id} className={a.done ? 'done' : ''} data-testid="deal-activity">
                  <input
                    type="checkbox"
                    checked={a.done}
                    aria-label={`Mark “${a.subject}” ${a.done ? 'not done' : 'done'}`}
                    data-testid="activity-done-toggle"
                    onChange={() => run(() => data.act((c) => c.setActivityDone({ activity_id: a.id, done: !a.done })))}
                  />
                  <KindIcon kind={a.kind} />
                  <div className="body">
                    <div className="subj">{a.subject}{a.automation_id && <Chip style={{ marginLeft: 6 }} title="Scheduled by an automation">auto</Chip>}</div>
                    {a.note && <div className="note">{a.note}</div>}
                  </div>
                  {a.done ? <span className="muted">done {relativeTime(a.done_at ?? 0, now)} ago</span> : <DueChip kind={a.kind} dueAt={a.due_at} now={now} />}
                  <button className="x" aria-label="Delete activity" onClick={() => run(() => data.act((c) => c.deleteActivity({ activity_id: a.id })))}>×</button>
                </li>
              ))}
            </List>
          </Panel>

          <Panel>
            <h3>Notes</h3>
            <NoteForm onAdd={(body) => run(() => data.act((c) => c.addNote({ deal_id: deal.id, body })))} />
            <List>
              {notes.map((n) => (
                <li key={n.id} data-testid="deal-note" className="note-item">
                  <div className="body">
                    <div className="note-body">{n.body}</div>
                    <div className="muted">{relativeTime(n.created_at, now)} ago</div>
                  </div>
                  {n.author === currentUser && (
                    <button className="x" aria-label="Delete note" onClick={() => run(() => data.act((c) => c.deleteNote({ note_id: n.id })))}>×</button>
                  )}
                </li>
              ))}
            </List>
          </Panel>
        </div>
      </Grid>

      {losing && (
        <LostReasonModal
          dealTitle={deal.title}
          onConfirm={(reason) => data.act((c) => c.markLost({ deal_id: deal.id, reason }))}
          onClose={() => setLosing(false)}
        />
      )}
    </Page>
  );
}

function ScheduleForm({ onSchedule }: { onSchedule: (kind: string, subject: string, due: number) => Promise<void> }) {
  const [kind, setKind] = useState('call');
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState(() => toDateInput(dueInDays(1)));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const day = fromDateInput(date);
    if (!subject.trim() || day === null || busy) return;
    const due = new Date(day);
    due.setHours(10, 0, 0, 0);
    setBusy(true);
    try {
      await onSchedule(kind, subject.trim(), due.getTime());
      setSubject('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row $gap={8} $wrap style={{ marginBottom: 8 }}>
      <Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 110 }} aria-label="Activity type" data-testid="activity-kind">
        {ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{ACTIVITY_LABEL[k]}</option>)}
      </Select>
      <Input
        style={{ flex: '1 1 180px', width: 'auto' }}
        placeholder="What needs to happen?"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        data-testid="activity-subject"
        aria-label="Activity subject"
      />
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 150 }} aria-label="Due date" data-testid="activity-date" />
      <Button $variant="primary" onClick={() => void submit()} disabled={!subject.trim() || busy} data-testid="activity-add">Schedule</Button>
    </Row>
  );
}

function NoteForm({ onAdd }: { onAdd: (body: string) => Promise<void> }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try { await onAdd(body.trim()); setBody(''); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
      <TextArea
        placeholder="What did you learn? Budget, decision makers, objections…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(); }}
        data-testid="note-input"
        aria-label="New note"
      />
      {body.trim() && (
        <Row style={{ justifyContent: 'flex-end' }}>
          <Button $variant="primary" $small onClick={() => void submit()} disabled={busy} data-testid="note-add">Add note</Button>
        </Row>
      )}
    </div>
  );
}

const Header = styled.div`
  display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap;
  .left { flex: 1; min-width: 240px; }
  h1 { font-size: 20px; font-weight: 650; letter-spacing: -0.02em; margin: 0; }
  .sub { font-size: 13px; color: ${t.color.text2}; margin-top: 4px; strong { color: ${t.color.text}; } }
`;
const Stepper = styled.div`
  display: flex; gap: 3px; overflow-x: auto;
  button {
    flex: 1 1 0; min-width: 90px; font-family: inherit; font-size: 11.5px; font-weight: 600;
    padding: 7px 10px; border: none; cursor: pointer; color: ${t.color.text2};
    background: ${t.color.raised}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%, 8px 50%);
    &:first-child { clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%); border-radius: 5px 0 0 5px; }
    &:hover:not(:disabled) { background: ${t.color.raised2}; color: ${t.color.text}; }
    &:disabled { cursor: default; }
    &.past { background: rgba(165,255,63,0.22); color: ${t.color.text}; }
    &.current { background: ${t.color.accent}; color: ${t.color.onAccent}; }
  }
`;
const Grid = styled.div`
  display: grid; grid-template-columns: minmax(260px, 340px) 1fr; gap: 16px; align-items: start;
  @media (max-width: 980px) { grid-template-columns: 1fr; }
  .col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .form { display: flex; flex-direction: column; gap: 10px; }
  .facts { font-size: 11.5px; color: ${t.color.text3}; margin-top: 12px; }
  .muted { font-size: 12px; color: ${t.color.text3}; }
  .link { color: ${t.color.text2}; font-size: 12.5px; &:hover { color: ${t.color.accent}; } }
  .actions { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }
  .actions .label { font-size: 11px; color: ${t.color.text3}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
`;
const HealthRow = styled.div`
  display: flex; gap: 14px; align-items: flex-start;
  .gauge {
    width: 54px; height: 54px; border-radius: 50%; flex: 0 0 auto; display: grid; place-items: center;
    background: conic-gradient(var(--c) var(--p), ${t.color.raised2} 0);
    position: relative;
    &::before { content: ''; position: absolute; inset: 5px; border-radius: 50%; background: ${t.color.panel}; }
    span { position: relative; font-weight: 700; font-size: 15px; font-variant-numeric: tabular-nums; }
  }
  .lvl { font-weight: 650; font-size: 13.5px; }
  .reasons { margin: 6px 0 0 16px; font-size: 12px; color: ${t.color.text2}; line-height: 1.6; }
`;
const Suggestion = styled.div`
  display: flex; align-items: center; gap: 12px; padding: 9px 11px;
  background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: 8px;
  > div { flex: 1; min-width: 0; }
  .t { font-size: 12.5px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .why { font-size: 11.5px; color: ${t.color.text3}; margin-top: 2px; }
`;
const EmailBox = styled.div`
  margin-top: 12px; background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: 8px; padding: 12px;
  display: flex; flex-direction: column; gap: 10px;
  .subj { font-size: 12.5px; font-weight: 600; span { color: ${t.color.text3}; font-weight: 500; margin-right: 6px; } }
  pre { font-family: inherit; font-size: 12.5px; white-space: pre-wrap; margin: 0; color: ${t.color.text2}; line-height: 1.55; }
  .mail { font-size: 11.5px; font-weight: 600; color: ${t.color.accent}; align-self: center; }
`;
const List = styled.ul`
  list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column;
  li {
    display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid ${t.color.border};
    color: ${t.color.text2}; font-size: 12.5px;
  }
  li.done .subj { text-decoration: line-through; color: ${t.color.text3}; }
  .body { flex: 1; min-width: 0; }
  .subj { color: ${t.color.text}; }
  .note { font-size: 11.5px; color: ${t.color.text3}; white-space: pre-wrap; margin-top: 2px; max-height: 3.2em; overflow: hidden; }
  .note-item { align-items: flex-start; }
  .note-body { color: ${t.color.text}; white-space: pre-wrap; line-height: 1.5; }
  .muted { font-size: 11.5px; color: ${t.color.text3}; white-space: nowrap; }
  input[type='checkbox'] { accent-color: ${t.color.accent}; width: 15px; height: 15px; cursor: pointer; }
  .x {
    background: none; border: none; color: ${t.color.text3}; cursor: pointer; font-size: 16px; padding: 0 4px;
    opacity: 0; transition: opacity 120ms ease-out;
    &:hover { color: ${t.color.danger}; }
    &:focus-visible { opacity: 1; }
  }
  li:hover .x { opacity: 1; }
`;
