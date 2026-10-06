import { Link } from "react-router-dom";

import { DeltaIcon, Empty, Sparkline } from "../components/bits";
import { deltaDir } from "../components/delta";
import { BarChartIcon, ChevronDownIcon } from "../components/icons";
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
      <>
        <MetricsHead />
        <Empty icon={<BarChartIcon size={20} />} title="No KPIs reported yet.">
          KPIs added to an update show up here as a trend, one line per metric.
        </Empty>
      </>
    );

  return (
    <>
    <MetricsHead />
    <div className="metricGrid">
      {series.map((s) => {
        const last = s.points[s.points.length - 1];
        const prev = s.points[s.points.length - 2];
        const delta = prev ? deltaLabel(prev.value, last.value) : null;
        return (
          <section key={s.name} className="metricCard" data-testid="metric-card">
            <div className="metricTop">
              <span className="kpiName">{s.name}</span>
              <span className="muted small">as of {formatDate(last.at)}</span>
            </div>
            <div className="kpiValue">
              {last.value}
              {s.unit && <small> {s.unit}</small>}
            </div>
            <div className="kpiFoot">
              {delta ? (
                <>
                  <span className="kpiDelta" data-dir={deltaDir(delta)}>
                    <DeltaIcon delta={delta} />
                    {delta}
                  </span>
                  <span className="muted small">since last report</span>
                </>
              ) : (
                <span className="muted small">First report</span>
              )}
            </div>
            <div className="sparkWrap">
              <Sparkline values={s.points.map((p) => p.value)} width={260} height={48} />
            </div>
            <details className="metricHistory">
              <summary>
                <span>{s.points.length} reports</span>
                <ChevronDownIcon size={14} className="summaryChevron" />
              </summary>
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
    </>
  );
}

function MetricsHead() {
  return (
    <div className="pageHead">
      <div>
        <h1 className="pageTitle">KPIs</h1>
        <p className="pageSub">Every metric reported in an update, as a series. Nothing is typed twice.</p>
      </div>
    </div>
  );
}
