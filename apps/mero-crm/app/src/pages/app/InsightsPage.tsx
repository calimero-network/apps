import React, { useMemo } from 'react';
import styled from 'styled-components';
import { tokens as t } from '../../theme';
import { Empty, Money, Page, Panel, Table } from '../../components/ui';
import { computeStats, dealHealth, formatMoney } from '../../utils/crm';
import { useAppCtx } from './appContext';

/**
 * The numbers a sales lead actually asks for: what is in the pipeline, what it
 * is likely worth, how often we win, why we lose, and who is carrying it.
 *
 * Every chart is one series in one hue (magnitude only), labelled in text ink
 * and backed by the exact figure on hover, so no reading depends on colour.
 */
export default function InsightsPage(): React.ReactElement {
  const { data } = useAppCtx();
  const now = Date.now();
  const { currency, rotting_days: rottingDays } = data.settings;
  const stats = useMemo(() => computeStats(data.deals, data.stages, now), [data.deals, data.stages, now]);
  const atRisk = useMemo(
    () => data.deals.filter((d) => d.status === 'open' && dealHealth(d, rottingDays, now).level !== 'healthy'),
    [data.deals, rottingDays, now],
  );

  if (data.deals.length === 0) {
    return <Empty><strong>No deals yet</strong>Insights fill in as your team adds and closes deals.</Empty>;
  }

  const m = (v: number) => formatMoney(v, currency, true);
  const maxStage = Math.max(1, ...stats.perStage.map((s) => s.value));
  const maxForecast = Math.max(1, ...stats.forecast.map((f) => f.weighted));
  const maxReason = Math.max(1, ...stats.lostReasons.map((r) => r.count));

  return (
    <Page>
      <Tiles>
        <Tile data-testid="kpi-open"><span className="k">Open pipeline</span><span className="v">{m(stats.openValue)}</span><span className="s">{stats.openCount} deals</span></Tile>
        <Tile data-testid="kpi-weighted" title="Each open deal's value × its stage probability"><span className="k">Weighted forecast</span><span className="v">{m(stats.weightedValue)}</span><span className="s">value × probability</span></Tile>
        <Tile data-testid="kpi-won-month"><span className="k">Won this month</span><span className="v">{m(stats.wonThisMonth)}</span><span className="s">{m(stats.wonValue)} all time</span></Tile>
        <Tile data-testid="kpi-win-rate"><span className="k">Win rate</span><span className="v">{stats.winRate == null ? '—' : `${stats.winRate}%`}</span><span className="s">{stats.wonCount} won · {stats.lostCount} lost</span></Tile>
        <Tile><span className="k">Avg won deal</span><span className="v">{stats.avgWonValue == null ? '—' : m(stats.avgWonValue)}</span><span className="s">&nbsp;</span></Tile>
        <Tile><span className="k">Avg sales cycle</span><span className="v">{stats.avgCycleDays == null ? '—' : `${stats.avgCycleDays}d`}</span><span className="s">created → won</span></Tile>
      </Tiles>

      <TwoCol>
        <Panel>
          <h3>Open value by stage</h3>
          <Bars>
            {stats.perStage.map((s) => (
              <div className="row" key={s.stage.id} title={`${s.stage.name}: ${s.count} deals · ${formatMoney(s.value, currency)} · weighted ${formatMoney(s.weighted, currency)}`}>
                <span className="lbl">{s.stage.name}</span>
                <span className="track"><span className="fill" style={{ width: `${(s.value / maxStage) * 100}%` }} /></span>
                <span className="val">{m(s.value)} <span className="muted">· {s.count}</span></span>
              </div>
            ))}
          </Bars>
        </Panel>

        <Panel>
          <h3>Weighted forecast by expected close</h3>
          <Columns>
            {stats.forecast.map((f) => (
              <div className="col" key={f.label} title={`${f.label}: ${formatMoney(f.weighted, currency)} weighted of ${formatMoney(f.value, currency)}`}>
                <span className="val">{f.weighted ? m(f.weighted) : ''}</span>
                <span className="track"><span className="fill" style={{ height: `${(f.weighted / maxForecast) * 100}%` }} /></span>
                <span className="lbl">{f.label}</span>
              </div>
            ))}
          </Columns>
          <div className="note" style={{ fontSize: 11.5, color: t.color.text3, marginTop: 8 }}>
            Deals whose close date has already passed count in the current month.
          </div>
        </Panel>
      </TwoCol>

      <TwoCol>
        <Panel>
          <h3>Why deals are lost</h3>
          {stats.lostReasons.length === 0 ? <div className="muted" style={{ fontSize: 12.5, color: t.color.text3 }}>No lost deals yet.</div> : (
            <Bars>
              {stats.lostReasons.slice(0, 8).map((r) => (
                <div className="row" key={r.reason} title={`${r.reason}: ${r.count}`}>
                  <span className="lbl">{r.reason}</span>
                  <span className="track"><span className="fill muted-fill" style={{ width: `${(r.count / maxReason) * 100}%` }} /></span>
                  <span className="val">{r.count}</span>
                </div>
              ))}
            </Bars>
          )}
        </Panel>

        <Panel>
          <h3>By owner</h3>
          <Table>
            <thead><tr><th>Owner</th><th className="num">Won</th><th className="num">Deals won</th><th className="num">Open</th></tr></thead>
            <tbody>
              {stats.byOwner.map((o) => (
                <tr key={o.owner} style={{ cursor: 'default' }}>
                  <td className="title">{o.owner}</td>
                  <td className="num"><Money value={o.wonValue} currency={currency} /></td>
                  <td className="num">{o.wonCount}</td>
                  <td className="num"><Money value={o.openValue} currency={currency} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </TwoCol>

      <Panel>
        <h3>Needs attention <span style={{ opacity: 0.7 }}>{atRisk.length}</span></h3>
        {atRisk.length === 0 ? <div style={{ fontSize: 12.5, color: t.color.text3 }}>Every open deal is on track.</div> : (
          <Table>
            <thead><tr><th>Deal</th><th className="num">Value</th><th>Why</th></tr></thead>
            <tbody>
              {atRisk
                .map((d) => ({ d, h: dealHealth(d, rottingDays, now) }))
                .sort((a, b) => a.h.score - b.h.score)
                .slice(0, 10)
                .map(({ d, h }) => (
                  <tr key={d.id} style={{ cursor: 'default' }}>
                    <td className="title">{d.title}</td>
                    <td className="num"><Money value={d.value} currency={currency} /></td>
                    <td className="muted">{h.reasons.join(' · ')}</td>
                  </tr>
                ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}

const Tiles = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px;
`;
const Tile = styled.div`
  background: ${t.color.panel}; border: 1px solid ${t.color.border}; border-radius: 10px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 4px;
  .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: ${t.color.text3}; font-weight: 600; }
  .v { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .s { font-size: 11.5px; color: ${t.color.text2}; }
`;
const TwoCol = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
  @media (max-width: 980px) { grid-template-columns: 1fr; }
`;
const Bars = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  .row { display: grid; grid-template-columns: 110px 1fr 90px; align-items: center; gap: 10px; font-size: 12px; }
  .lbl { color: ${t.color.text2}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track { height: 12px; }
  .fill { display: block; height: 100%; min-width: 2px; background: ${t.color.accent}; border-radius: 0 4px 4px 0; }
  .muted-fill { background: ${t.color.medium}; }
  .val { text-align: right; font-variant-numeric: tabular-nums; color: ${t.color.text}; }
  .muted { color: ${t.color.text3}; }
`;
const Columns = styled.div`
  display: flex; align-items: flex-end; gap: 8px; height: 170px; padding-top: 6px;
  .col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; min-width: 0; }
  .track { flex: 1; width: 100%; max-width: 38px; display: flex; align-items: flex-end; border-bottom: 1px solid ${t.color.border}; }
  .fill { display: block; width: 100%; min-height: 2px; background: ${t.color.accent}; border-radius: 4px 4px 0 0; }
  .val { font-size: 10.5px; color: ${t.color.text2}; font-variant-numeric: tabular-nums; white-space: nowrap; height: 14px; }
  .lbl { font-size: 11px; color: ${t.color.text3}; white-space: nowrap; }
`;
