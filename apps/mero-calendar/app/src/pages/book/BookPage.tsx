import { useCallback, useEffect, useMemo, useState } from "react";

import {
  formatWhen,
  guest,
  parseBookingFragment,
  type BookingPage,
  type BookingLinkTarget,
} from "../../api/booking";
import ThemeToggle from "../../components/common/theme-toggle/ThemeToggle";
import styles from "./book.module.scss";

const DAY_MS = 86_400_000;
/** How far one "show more" reaches. */
const SLOT_PAGE_DAYS = 14;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Slots grouped by the guest's own calendar day. */
export function groupByDay(slots: number[]): Array<{ day: string; slots: number[] }> {
  const groups = new Map<string, number[]>();
  for (const slot of slots) {
    const day = new Date(slot).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const list = groups.get(day) ?? [];
    list.push(slot);
    groups.set(day, list);
  }
  return Array.from(groups, ([day, daySlots]) => ({ day, slots: daySlots }));
}

function SlotPicker({
  target,
  selected,
  onSelect,
}: {
  target: BookingLinkTarget;
  selected: number | null;
  onSelect: (slot: number) => void;
}) {
  const [slots, setSlots] = useState<number[] | null>(null);
  const [until, setUntil] = useState(() => Date.now() + SLOT_PAGE_DAYS * DAY_MS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    guest
      .slots(target, Date.now(), until)
      .then((found) => live && setSlots(found ?? []))
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [target, until]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!slots) return <p className={styles.dim}>Finding open times…</p>;

  const days = groupByDay(slots);
  return (
    <div className={styles.slots}>
      {days.length === 0 && <p className={styles.dim}>No open times in this range.</p>}
      {days.map(({ day, slots: daySlots }) => (
        <div key={day} className={styles.day}>
          <h3 className={styles.dayName}>{day}</h3>
          <div className={styles.times}>
            {daySlots.map((slot) => (
              <button
                key={slot}
                type="button"
                className={slot === selected ? styles.timeOn : styles.time}
                onClick={() => onSelect(slot)}
                data-testid="slot"
              >
                {new Date(slot).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </button>
            ))}
          </div>
        </div>
      ))}
      {/* The contract answers at most 62 days per call. */}
      {until - Date.now() + SLOT_PAGE_DAYS * DAY_MS <= 60 * DAY_MS && (
        <button
          type="button"
          className="mc-btn mc-btn--ghost"
          onClick={() => setUntil(until + SLOT_PAGE_DAYS * DAY_MS)}
        >
          Show later times
        </button>
      )}
    </div>
  );
}

/**
 * The page a booking link opens. No login: the token in the URL's fragment is
 * the guest's whole credential, and it reaches the owner's node and nothing
 * else.
 */
export default function BookPage() {
  const target = useMemo(() => parseBookingFragment(window.location.hash), []);
  const [page, setPage] = useState<BookingPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!target) return;
    try {
      setPage(await guest.page(target));
    } catch (err) {
      setError(errorText(err));
    }
  }, [target]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setSelected(null);
      setRescheduling(false);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!target) {
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <h1 className={styles.title}>This booking link is incomplete</h1>
          <p className={styles.dim}>Ask the person who sent it for the whole link.</p>
        </section>
      </main>
    );
  }

  const canBook = name.trim() && email.includes("@") && selected !== null;

  return (
    <main className={styles.page} data-testid="book-page">
      <div className={styles.toggle}>
        <ThemeToggle />
      </div>
      <section className={styles.card}>
        {!page && !error && <p className={styles.dim}>Loading…</p>}
        {page && (
          <>
            <p className={styles.eyebrow}>{page.ownerName ? `Meet ${page.ownerName}` : "Book a time"}</p>
            <h1 className={styles.title}>{page.title}</h1>
            <p className={styles.dim}>
              {page.durationMinutes} minutes
              {page.description ? ` · ${page.description}` : ""}
            </p>
            <p className={styles.dim}>
              Times are shown in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
            </p>

            {page.status === "cancelled" && (
              <p className={styles.notice}>This meeting was cancelled. The link has been used.</p>
            )}

            {page.status === "booked" && page.booking && (
              <div className={styles.notice} data-testid="booked">
                <strong>Booked: {formatWhen(page.booking.startMs)}</strong>
                <div className={styles.dim}>
                  {page.booking.guestName} · {page.booking.guestEmail}
                </div>
                {!rescheduling && (
                  <div className={styles.actions}>
                    <button
                      className="mc-btn"
                      disabled={busy}
                      onClick={() => setRescheduling(true)}
                    >
                      Reschedule
                    </button>
                    <button
                      className="mc-btn mc-btn--danger"
                      disabled={busy}
                      onClick={() => void run(() => guest.cancel(target))}
                    >
                      Cancel meeting
                    </button>
                  </div>
                )}
              </div>
            )}

            {(page.status === "open" || rescheduling) && (
              <>
                <h2 className={styles.subhead}>
                  {rescheduling ? "Pick a new time" : "Pick a time"}
                </h2>
                <SlotPicker target={target} selected={selected} onSelect={setSelected} />
              </>
            )}

            {page.status === "open" && (
              <div className={styles.form}>
                <input
                  className="mc-input"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <input
                  className="mc-input"
                  placeholder="Your email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <textarea
                  className="mc-input"
                  placeholder="Anything they should know? (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                />
                <button
                  className="mc-btn mc-btn--primary"
                  disabled={!canBook || busy}
                  onClick={() =>
                    void run(() =>
                      guest.book(target, selected as number, { name, email, note }),
                    )
                  }
                  data-testid="book-submit"
                >
                  {selected ? `Book ${formatWhen(selected)}` : "Book"}
                </button>
              </div>
            )}

            {rescheduling && (
              <div className={styles.actions}>
                <button className="mc-btn mc-btn--ghost" onClick={() => setRescheduling(false)}>
                  Keep current time
                </button>
                <button
                  className="mc-btn mc-btn--primary"
                  disabled={selected === null || busy}
                  onClick={() => void run(() => guest.reschedule(target, selected as number))}
                >
                  Move meeting
                </button>
              </div>
            )}
          </>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <p className={styles.footnote}>
          Keep this link to reschedule or cancel. Anyone holding it can change this booking.
        </p>
      </section>
    </main>
  );
}
