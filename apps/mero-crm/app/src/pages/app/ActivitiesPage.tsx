import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import { KindIcon } from '../../components/icons';
import { Button, Chip, DueChip, Empty, Input, Page, Panel, Row, Select } from '../../components/ui';
import {
  ACTIVITY_KINDS, ACTIVITY_LABEL, bucketActivities, dueInDays, fromDateInput, toDateInput,
  type ActivityBucket,
} from '../../utils/crm';
import { describeError } from '../../utils/errors';
import type { ActivityView } from '../../hooks/useCrm';
import { useAppCtx } from './appContext';

const SECTIONS: { key: ActivityBucket; title: string; empty: string }[] = [
  { key: 'overdue', title: 'Overdue', empty: '' },
  { key: 'today', title: 'Today', empty: 'Nothing due today.' },
  { key: 'upcoming', title: 'Upcoming', empty: 'Nothing scheduled ahead.' },
  { key: 'done', title: 'Recently done', empty: '' },
];

/** The to-do list: every call, meeting and task across the pipeline, grouped by
 *  when it is due. Overdue first, because that is the list that loses deals. */
export default function ActivitiesPage(): React.ReactElement {
  const { data, ownerFilter, searchQuery, myName } = useAppCtx();
  const toast = useToast();
  const now = Date.now();
  const [kindFilter, setKindFilter] = useState('');

  const list = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.activities
      .filter((a) => !ownerFilter || a.owner === ownerFilter)
      .filter((a) => !kindFilter || a.kind === kindFilter)
      .filter((a) => !q || a.subject.toLowerCase().includes(q) || (a.deal_title ?? '').toLowerCase().includes(q));
  }, [data.activities, ownerFilter, kindFilter, searchQuery]);
  const buckets = useMemo(() => bucketActivities(list, now), [list, now]);

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (err) { toast.show({ variant: 'error', description: describeError(err) }); }
  };

  return (
    <Page>
      <Row $wrap $gap={10}>
        <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ width: 150 }} aria-label="Filter by type">
          <option value="">All types</option>
          {ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{ACTIVITY_LABEL[k]}</option>)}
        </Select>
        <span style={{ fontSize: 12.5, color: t.color.text2 }}>
          <strong style={{ color: buckets.overdue.length ? t.color.urgent : t.color.text }}>{buckets.overdue.length}</strong> overdue ·{' '}
          <strong style={{ color: t.color.text }}>{buckets.today.length}</strong> today ·{' '}
          <strong style={{ color: t.color.text }}>{buckets.upcoming.length}</strong> upcoming
        </span>
      </Row>

      <QuickAdd
        deals={data.deals.filter((d) => d.status === 'open').map((d) => ({ id: d.id, title: d.title, contactId: d.contact_id }))}
        onAdd={(dealId, contactId, kind, subject, due) => run(() => data.act((c) => c.addActivity({
          deal_id: dealId, contact_id: contactId, kind, subject, due_at: due, owner: myName || null, note: '',
        })))}
      />

      {list.length === 0 && (
        <Empty>
          <strong>No activities{ownerFilter ? ` for ${ownerFilter}` : ''}</strong>
          Schedule one above, or from a deal. Automations in Settings can schedule them for you.
        </Empty>
      )}
      {list.length > 0 && SECTIONS.map(({ key, title, empty }) => {
        const items = key === 'done' ? buckets.done.slice(0, 20) : buckets[key];
        if (!items.length && !empty) return null;
        return (
          <Panel key={key} data-testid={`activities-${key}`}>
            <h3 style={key === 'overdue' ? { color: t.color.urgent } : undefined}>
              {title} <span style={{ opacity: 0.7 }}>{items.length}</span>
            </h3>
            {items.length === 0 ? <div style={{ fontSize: 12.5, color: t.color.text3 }}>{empty}</div> : (
              <Items>
                {items.map((a) => (
                  <ActivityRow
                    key={a.id}
                    a={a}
                    now={now}
                    onToggle={() => run(() => data.act((c) => c.setActivityDone({ activity_id: a.id, done: !a.done })))}
                    onSnooze={() => run(() => data.act((c) => c.rescheduleActivity({ activity_id: a.id, due_at: dueInDays(1, now) })))}
                  />
                ))}
              </Items>
            )}
          </Panel>
        );
      })}
    </Page>
  );
}

function ActivityRow({ a, now, onToggle, onSnooze }: { a: ActivityView; now: number; onToggle: () => void; onSnooze: () => void }) {
  return (
    <li className={a.done ? 'done' : ''} data-testid="activity-row">
      <input type="checkbox" checked={a.done} onChange={onToggle} aria-label={`Mark “${a.subject}” ${a.done ? 'not done' : 'done'}`} data-testid="activity-row-toggle" />
      <KindIcon kind={a.kind} />
      <div className="body">
        <div className="subj">{a.subject}</div>
        <div className="meta">
          {a.deal_id && a.deal_title ? <Link to={`${APP_ROUTE}/deals/${a.deal_id}`}>{a.deal_title}</Link> : 'No deal'}
          {a.owner && <> · {a.owner}</>}
        </div>
      </div>
      {a.automation_id && <Chip title="Scheduled by an automation">auto</Chip>}
      {!a.done && <DueChip kind={a.kind} dueAt={a.due_at} now={now} />}
      {!a.done && <Button $small onClick={onSnooze} title="Move to tomorrow">Tomorrow</Button>}
    </li>
  );
}

function QuickAdd({
  deals, onAdd,
}: {
  deals: { id: string; title: string; contactId: string | null }[];
  onAdd: (dealId: string | null, contactId: string | null, kind: string, subject: string, due: number) => Promise<void>;
}) {
  const [kind, setKind] = useState('task');
  const [subject, setSubject] = useState('');
  const [dealId, setDealId] = useState('');
  const [date, setDate] = useState(() => toDateInput(Date.now()));
  const submit = async () => {
    const day = fromDateInput(date);
    if (!subject.trim() || day === null) return;
    const due = new Date(day);
    due.setHours(10, 0, 0, 0);
    await onAdd(dealId || null, deals.find((d) => d.id === dealId)?.contactId ?? null, kind, subject.trim(), due.getTime());
    setSubject('');
  };
  return (
    <Panel>
      <Row $wrap $gap={8}>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 110 }} aria-label="Activity type">
          {ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{ACTIVITY_LABEL[k]}</option>)}
        </Select>
        <Input
          style={{ flex: '2 1 200px', width: 'auto' }}
          placeholder="Add an activity… e.g. Call Ada about pricing"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          data-testid="quick-activity-subject"
          aria-label="Activity subject"
        />
        <Select value={dealId} onChange={(e) => setDealId(e.target.value)} style={{ flex: '1 1 160px', width: 'auto' }} aria-label="Deal">
          <option value="">No deal</option>
          {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </Select>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 150 }} aria-label="Due date" />
        <Button $variant="primary" onClick={() => void submit()} disabled={!subject.trim()} data-testid="quick-activity-add">Add</Button>
      </Row>
    </Panel>
  );
}

const Items = styled.ul`
  list-style: none; margin: 0; padding: 0;
  li { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid ${t.color.border}; font-size: 12.5px; }
  li:first-child { border-top: none; padding-top: 2px; }
  li.done .subj { text-decoration: line-through; color: ${t.color.text3}; }
  .body { flex: 1; min-width: 0; }
  .subj { color: ${t.color.text}; font-weight: 500; }
  .meta { font-size: 11.5px; color: ${t.color.text3}; a { color: ${t.color.text2}; &:hover { color: ${t.color.accent}; } } }
  input[type='checkbox'] { accent-color: ${t.color.accent}; width: 15px; height: 15px; cursor: pointer; }
`;
