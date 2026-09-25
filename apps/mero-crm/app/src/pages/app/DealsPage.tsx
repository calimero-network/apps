import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_ROUTE } from '../../config';
import { Chip, DueChip, Empty, HealthDot, Money, Page, Row, StatusBadge, Table, Tabs } from '../../components/ui';
import { dealHealth, dealMatches, formatMoney } from '../../utils/crm';
import { formatDate } from '../../utils/display';
import { useAppCtx } from './appContext';
import { tokens as t } from '../../theme';

type StatusTab = 'open' | 'won' | 'lost' | 'all';
type SortKey = 'value' | 'close' | 'health' | 'created';

/** Every deal as a sortable table — for when the board is too visual. */
export default function DealsPage(): React.ReactElement {
  const { data, ownerFilter, searchQuery } = useAppCtx();
  const navigate = useNavigate();
  const [tab, setTab] = useState<StatusTab>('open');
  const [sort, setSort] = useState<SortKey>('created');
  const now = Date.now();
  const { currency, rotting_days: rottingDays } = data.settings;
  const stageName = useMemo(() => new Map(data.stages.map((s) => [s.id, s.name])), [data.stages]);

  const rows = useMemo(() => {
    const list = data.deals
      .filter((d) => tab === 'all' || d.status === tab)
      .filter((d) => !ownerFilter || d.owner === ownerFilter)
      .filter((d) => dealMatches(d, searchQuery))
      .map((d) => ({ deal: d, health: dealHealth(d, rottingDays, now) }));
    const by: Record<SortKey, (a: typeof list[number], b: typeof list[number]) => number> = {
      value: (a, b) => b.deal.value - a.deal.value,
      close: (a, b) => (a.deal.expected_close ?? Infinity) - (b.deal.expected_close ?? Infinity),
      health: (a, b) => a.health.score - b.health.score,
      created: (a, b) => b.deal.created_at - a.deal.created_at,
    };
    return list.sort(by[sort]);
  }, [data.deals, tab, ownerFilter, searchQuery, rottingDays, now, sort]);

  const counts = useMemo(() => {
    const c = { open: 0, won: 0, lost: 0, all: data.deals.length };
    for (const d of data.deals) c[d.status as 'open' | 'won' | 'lost'] += 1;
    return c;
  }, [data.deals]);

  const total = rows.reduce((a, r) => a + r.deal.value, 0);

  const th = (key: SortKey, label: string, cls = '') => (
    <th className={cls}>
      <button
        onClick={() => setSort(key)}
        style={{ all: 'unset', cursor: 'pointer', color: sort === key ? t.color.text : undefined }}
      >
        {label}{sort === key ? ' ↓' : ''}
      </button>
    </th>
  );

  return (
    <Page>
      <Row $wrap $gap={12}>
        <Tabs role="group" aria-label="Deal status">
          {(['open', 'won', 'lost', 'all'] as StatusTab[]).map((k) => (
            <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)} data-testid={`deals-tab-${k}`}>
              {k[0].toUpperCase() + k.slice(1)} <span style={{ opacity: 0.6 }}>{counts[k]}</span>
            </button>
          ))}
        </Tabs>
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: t.color.text2 }}>
          {rows.length} deals · <strong style={{ color: t.color.text }}>{formatMoney(total, currency)}</strong>
        </span>
      </Row>
      {rows.length === 0 ? (
        <Empty>
          <strong>No {tab === 'all' ? '' : tab} deals{searchQuery.trim() ? ` matching “${searchQuery.trim()}”` : ''}</strong>
          {tab === 'open' && 'Add one with + Deal, or press N.'}
        </Empty>
      ) : (
        <Table data-testid="deals-table">
          <thead>
            <tr>
              <th style={{ width: 18 }} aria-label="Health" />
              <th>Deal</th>
              {th('value', 'Value', 'num')}
              <th>Stage</th>
              <th>Owner</th>
              <th>Next step</th>
              {th('close', 'Expected close')}
              {th('health', 'Health')}
              {th('created', 'Added')}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ deal, health }) => (
              <tr key={deal.id} data-testid="deal-row" onClick={() => navigate(`${APP_ROUTE}/deals/${deal.id}`)}>
                <td><HealthDot health={health} /></td>
                <td>
                  <div className="title">{deal.title}</div>
                  <div className="muted">{[deal.organization, deal.contact_name].filter(Boolean).join(' · ') || '—'}</div>
                </td>
                <td className="num"><Money value={deal.value} currency={currency} /></td>
                <td>
                  {deal.status === 'open' ? (stageName.get(deal.stage_id) ?? '—') : <StatusBadge status={deal.status} />}
                </td>
                <td>{deal.owner ?? <span className="muted">Unassigned</span>}</td>
                <td>
                  {deal.status !== 'open' ? <span className="muted">{deal.lost_reason || '—'}</span>
                    : deal.next_activity ? <DueChip kind={deal.next_activity.kind} dueAt={deal.next_activity.due_at} subject={deal.next_activity.subject} now={now} />
                      : <Chip $color={t.color.high}>None</Chip>}
                </td>
                <td className={deal.expected_close && deal.expected_close < now && deal.status === 'open' ? '' : 'muted'}
                  style={deal.expected_close && deal.expected_close < now && deal.status === 'open' ? { color: t.color.urgent } : undefined}>
                  {deal.expected_close ? formatDate(deal.expected_close) : '—'}
                </td>
                <td className="num">{deal.status === 'open' ? health.score : '—'}</td>
                <td className="muted">{formatDate(deal.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Page>
  );
}
