/**
 * ChartView — one chart as SVG: grouped bars or lines over labels, one
 * y-axis from zero with round ticks, a legend for two or more series, a
 * hover tooltip per label, and a table of the same numbers.
 *
 * Marks follow the data-viz specs: bars at most 24px with a 4px rounded end
 * and a 2px gap between neighbours, 2px lines with ringed end markers, hairline
 * recessive grid, text in text colours (never the series colour).
 */
import React, { useState } from 'react';
import styled from 'styled-components';
import { C } from '../theme';
import { formatTick, niceTicks, type ChartModel } from '../spreadsheet/chart';

const W = 400;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 44 };
const series = (i: number) => `var(--c-series-${i + 1})`;

export default function ChartView({ model, kind, title }: { model: ChartModel; kind: 'bar' | 'line'; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const values = model.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const ticks = niceTicks(values.length ? Math.min(...values) : 0, values.length ? Math.max(...values) : 1);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const n = Math.max(model.labels.length, 1);
  const band = plotW / n;
  const x = (i: number) => PAD.left + band * i + band / 2;
  const zero = y(0);
  const barW = Math.max(2, Math.min(24, (band * 0.8) / Math.max(model.series.length, 1) - 2));
  // Show every label when they fit, else every k-th.
  const every = Math.max(1, Math.ceil(n / Math.floor(plotW / 44)));

  const barPath = (cx: number, v: number) => {
    const top = y(v);
    const h = Math.abs(zero - top);
    const r = Math.min(4, h, barW / 2);
    const left = cx - barW / 2;
    if (v >= 0) {
      return `M${left},${zero} V${top + r} Q${left},${top} ${left + r},${top} H${left + barW - r} Q${left + barW},${top} ${left + barW},${top + r} V${zero} Z`;
    }
    return `M${left},${zero} V${top - r} Q${left},${top} ${left + r},${top} H${left + barW - r} Q${left + barW},${top} ${left + barW},${top - r} V${zero} Z`;
  };

  return (
    <Figure>
      <Head>
        <figcaption>{title || model.series.map((s) => s.name).join(', ')}</figcaption>
        <button type="button" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? 'Chart' : 'Show data'}
        </button>
      </Head>
      {model.series.length >= 2 && !table && (
        <Legend aria-label="Legend">
          {model.series.map((s, i) => (
            <li key={s.name + i}>
              <i style={{ background: series(i) }} aria-hidden="true" />
              {s.name}
            </li>
          ))}
        </Legend>
      )}
      {table ? (
        <Table>
          <thead>
            <tr><th scope="col" />{model.series.map((s, i) => <th key={i} scope="col">{s.name}</th>)}</tr>
          </thead>
          <tbody>
            {model.labels.map((l, r) => (
              <tr key={r}>
                <th scope="row">{l}</th>
                {model.series.map((s, i) => <td key={i}>{s.values[r] === null ? '—' : formatTick(s.values[r]!)}</td>)}
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Plot>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${kind === 'bar' ? 'Bar' : 'Line'} chart: ${title}`} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.muted : C.line} strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end" className="tick">{formatTick(t)}</text>
              </g>
            ))}
            {model.labels.map((l, i) => (i % every === 0 ? (
              <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className="tick">{l.length > 8 ? `${l.slice(0, 7)}…` : l}</text>
            ) : null))}
            {kind === 'bar' && model.series.map((s, si) => s.values.map((v, i) => (v === null ? null : (
              <path
                key={`${si}-${i}`}
                d={barPath(x(i) + (si - (model.series.length - 1) / 2) * (barW + 2), v)}
                fill={series(si)}
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
            ))))}
            {kind === 'line' && model.series.map((s, si) => {
              const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`));
              const segments: string[][] = [[]];
              for (const p of pts) {
                if (p) segments[segments.length - 1].push(p);
                else segments.push([]);
              }
              const last = s.values.map((v, i) => [v, i] as const).filter(([v]) => v !== null).pop();
              return (
                <g key={si}>
                  {segments.filter((g) => g.length > 1).map((g, k) => (
                    <polyline key={k} points={g.join(' ')} fill="none" stroke={series(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  ))}
                  {last && <circle cx={x(last[1])} cy={y(last[0]!)} r={4} fill={series(si)} stroke={C.paper} strokeWidth={2} />}
                  {hover !== null && s.values[hover] !== null && (
                    <circle cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={series(si)} stroke={C.paper} strokeWidth={2} />
                  )}
                </g>
              );
            })}
            {kind === 'line' && hover !== null && (
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke={C.muted} strokeWidth={1} />
            )}
            {/* Hit targets: the whole band of each label. */}
            {model.labels.map((_, i) => (
              <rect key={i} x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent"
                onMouseEnter={() => setHover(i)} data-testid="chart-band" />
            ))}
          </svg>
          {hover !== null && (
            <Tip style={{ left: `${(x(hover) / W) * 100}%` }} role="status" data-testid="chart-tip">
              <strong>{model.labels[hover]}</strong>
              {model.series.map((s, i) => (
                <span key={i}>
                  <i style={{ background: series(i) }} aria-hidden="true" />
                  {s.name}: {s.values[hover] === null ? '—' : formatTick(s.values[hover]!)}
                </span>
              ))}
            </Tip>
          )}
        </Plot>
      )}
      {model.dropped > 0 && <Note>{model.dropped} more column{model.dropped === 1 ? '' : 's'} not shown (a chart shows eight series).</Note>}
    </Figure>
  );
}

const Figure = styled.figure`margin: 0; padding: 12px 0 16px; border-bottom: 1px solid ${C.line};`;
const Head = styled.div`
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px;
  figcaption { font-size: 13.5px; font-weight: 650; color: ${C.ink}; }
  button { font-size: 11.5px; color: ${C.muted}; background: none; border: none; cursor: pointer; padding: 0; }
  button:hover { color: ${C.ink}; }
`;
const Legend = styled.ul`
  display: flex; flex-wrap: wrap; gap: 4px 12px; list-style: none; margin: 0 0 6px; padding: 0;
  li { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: ${C.muted}; }
  i { width: 10px; height: 10px; border-radius: 3px; }
`;
const Plot = styled.div`
  position: relative;
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  .tick { font-size: 10px; fill: ${C.muted}; font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
`;
const Tip = styled.div`
  position: absolute; top: 0; transform: translateX(-50%); pointer-events: none;
  display: flex; flex-direction: column; gap: 2px; padding: 6px 9px; border-radius: 8px;
  font-size: 11.5px; color: ${C.ink}; background: ${C.paper}; border: 1px solid ${C.line};
  box-shadow: 0 8px 24px -10px rgba(14, 20, 15, 0.4); white-space: nowrap;
  span { display: flex; align-items: center; gap: 5px; color: ${C.muted}; }
  i { width: 8px; height: 8px; border-radius: 2px; }
`;
const Table = styled.table`
  width: 100%; border-collapse: collapse; font-size: 12px;
  th, td { padding: 4px 6px; border-bottom: 1px solid ${C.line}; text-align: right; color: ${C.ink}; }
  th[scope='row'], thead th:first-child { text-align: left; color: ${C.muted}; font-weight: 500; }
  thead th { color: ${C.muted}; font-weight: 600; }
  td { font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
`;
const Note = styled.p`margin: 6px 0 0; font-size: 11.5px; color: ${C.mutedSoft};`;
