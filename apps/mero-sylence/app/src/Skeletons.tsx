import "./polish.css";

/** A grey bar that shimmers while what it stands for loads. */
function Bone({ w, h = 12, round = false }: { w: string; h?: number; round?: boolean }) {
  return <span className={`bone${round ? " round" : ""}`} style={{ width: w, height: h }} aria-hidden="true" />;
}

const LINE_WIDTHS = ["82%", "64%", "90%", "48%", "76%", "58%"];

/** The meeting page's shape while it loads: header, player and transcript lines. */
export function MeetingSkeleton({ withPlayer = true }: { withPlayer?: boolean }) {
  return (
    <div className="meeting-skeleton" aria-busy="true" data-testid="meeting-skeleton">
      <span className="visually-hidden-text">Loading the meeting…</span>
      <section className="card skel-head">
        <Bone w="96px" />
        <div className="skel-head-main">
          <Bone w="44px" h={44} round />
          <div className="skel-stack">
            <Bone w="46%" h={20} />
            <Bone w="62%" />
            <Bone w="34%" />
          </div>
        </div>
      </section>
      {withPlayer && (
        <section className="card skel-player">
          <Bone w="40px" h={40} round />
          <div className="skel-stack grow">
            <Bone w="100%" h={10} />
            <Bone w="100%" h={10} />
          </div>
        </section>
      )}
      <section className="card">
        <TranscriptSkeleton />
      </section>
    </div>
  );
}

/** Transcript lines while they load. */
export function TranscriptSkeleton({ lines = 6 }: { lines?: number }) {
  return (
    <ul className="skel-lines" aria-hidden="true">
      {LINE_WIDTHS.slice(0, lines).map((w, i) => (
        <li key={i} style={{ animationDelay: `${i * 60}ms` }}>
          <Bone w="40px" />
          <Bone w="72px" h={18} round />
          <Bone w={w} />
        </li>
      ))}
    </ul>
  );
}

/** The meetings list while it loads. */
export function MeetingsSkeleton() {
  return (
    <section className="card skel-list" aria-busy="true" data-testid="meetings-skeleton">
      <span className="visually-hidden-text">Loading meetings…</span>
      <ul aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} style={{ animationDelay: `${i * 70}ms` }}>
            <Bone w="36px" h={36} round />
            <div className="skel-stack grow">
              <Bone w={`${52 - i * 6}%`} h={14} />
              <Bone w="30%" />
            </div>
            <Bone w="56px" />
          </li>
        ))}
      </ul>
    </section>
  );
}
