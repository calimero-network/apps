import { Link } from "react-router-dom";

import { Empty, Sparkline } from "../components/bits";
import { deltaLabel, formatDate, useLive } from "../lib/updates";

/**
 * Every KPI the company has ever reported, as a series.
 *
 * The data is simply every update's metrics, grouped by name — nothing is
 * typed twice. For an investor it is the "how is this company actually
 * doing" page that a pile of emails never adds up to.
 */
export default function MetricsPage() {
  const metrics = useLive((c) => c.listMetrics(), []);
  const series = metrics.data ?? [];

  if (!metrics.loading && series.length === 0)
    return (
      <Empty title="No KPIs reported yet.">
        KPIs added to an update show up here as a trend, one line per metric.
      </Empty>
    );

  return (
    <div className="metricGrid">
      {series.map((s) => {
        const last = s.points[s.points.length - 1];
        const prev = s.points[s.points.length - 2];
        const delta = prev ? deltaLabel(prev.value, last.value) : null;
        return (
          <section key={s.name} className="metricCard" data-testid="metric-card">
            <div className="kpiName">{s.name}</div>
            <div className="kpiValue">
              {last.value}
              {s.unit && <small> {s.unit}</small>}
            </div>
            {delta && (
              <div className="kpiDelta" data-dir={delta.startsWith("+") ? "up" : delta.startsWith("−") ? "down" : "flat"}>
                {delta} since last report
              </div>
            )}
            <div className="sparkWrap">
              <Sparkline values={s.points.map((p) => p.value)} width={220} height={48} />
            </div>
            <details>
              <summary className="small muted">{s.points.length} reports</summary>
              <table className="history">
                <tbody>
                  {[...s.points].reverse().map((p) => (
                    <tr key={p.post_id}>
                      <td>{formatDate(p.at)}</td>
                      <td>
                        <Link to={`/a/p/${p.post_id}`}>{p.post_title}</Link>
                      </td>
                      <td className="num">{p.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>
        );
      })}
    </div>
  );
}
