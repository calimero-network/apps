import { useCallback, useEffect, useState } from "react";
import type { ExecuteTransport } from "@calimero-apps/cloud";

import type { OwnerNode } from "../../../../api/accessGrants";
import {
  createBookingLink,
  deleteBookingLink,
  formatWhen,
  listBookingLinks,
  type BookingLinkView,
  type WeeklyWindow,
} from "../../../../api/booking";
import styles from "./booking-links-modal.module.scss";

interface Props {
  node: OwnerNode;
  rpc: ExecuteTransport;
  contextId: string;
  onClose: () => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DURATIONS = [15, 30, 45, 60, 90];

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The owner's booking links: make one, copy its URL, see what was booked, and
 * delete it (which also revokes its access grant).
 *
 * A link's URL is shown once, right after it is made: the token in it is not
 * stored anywhere the owner can read it back, by design.
 */
export default function BookingLinksModal({ node, rpc, contextId, onClose }: Props) {
  const [links, setLinks] = useState<BookingLinkView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [title, setTitle] = useState("Intro call");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(30);
  const [days, setDays] = useState<boolean[]>([true, true, true, true, true, false, false]);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("17:00");
  const [horizonDays, setHorizonDays] = useState(14);
  const [noticeHours, setNoticeHours] = useState(4);

  const refresh = useCallback(async () => {
    try {
      setLinks(await listBookingLinks(rpc, contextId));
    } catch (err) {
      setError(errorText(err));
    }
  }, [rpc, contextId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startMinute = toMinutes(from);
  const endMinute = toMinutes(to);
  const valid =
    title.trim().length > 0 && days.some(Boolean) && startMinute + duration <= endMinute;

  async function onCreate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const weeklyHours: WeeklyWindow[] = days.flatMap((on, weekday) =>
        on ? [{ weekday, startMinute, endMinute }] : [],
      );
      const { url } = await createBookingLink(node, rpc, contextId, {
        title: title.trim(),
        description: description.trim(),
        durationMinutes: duration,
        weeklyHours,
        horizonDays,
        minNoticeMinutes: noticeHours * 60,
      });
      setCreated(url);
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(link: BookingLinkView) {
    setBusy(true);
    setError(null);
    try {
      await deleteBookingLink(node, rpc, contextId, link);
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
    } catch {
      /* the field is selectable; copying by hand still works */
    }
  }

  return (
    <div className="mc-overlay" data-testid="booking-links-modal" onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2 className={styles.title}>Booking links</h2>
          <button className="mc-btn mc-btn--ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <p className={styles.sub}>
          A booking link lets one person book one meeting with you, then reschedule or cancel it
          with the same link. They need no account. Your node must be reachable from their
          browser.
        </p>

        {created && (
          <div className={styles.created} data-testid="booking-link-created">
            <label className={styles.label}>
              Send this link. It is shown once.
              <input className="mc-input" readOnly value={created} onFocus={(e) => e.target.select()} />
            </label>
            <button className="mc-btn mc-btn--primary" onClick={onCopy}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        )}

        <section className={styles.form}>
          <label className={styles.label}>
            Title
            <input className="mc-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className={styles.label}>
            Note for the guest (optional)
            <input
              className="mc-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className={styles.row}>
            <label className={styles.label}>
              Length
              <select
                className="mc-input"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} min
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.label}>
              From
              <input
                className="mc-input"
                type="time"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className={styles.label}>
              To
              <input className="mc-input" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <div className={styles.days} role="group" aria-label="Days">
            {WEEKDAYS.map((name, i) => (
              <button
                key={name}
                type="button"
                className={days[i] ? styles.dayOn : styles.day}
                aria-pressed={days[i]}
                onClick={() => setDays(days.map((on, j) => (j === i ? !on : on)))}
              >
                {name}
              </button>
            ))}
          </div>
          <div className={styles.row}>
            <label className={styles.label}>
              Bookable up to (days ahead)
              <input
                className="mc-input"
                type="number"
                min={1}
                max={365}
                value={horizonDays}
                onChange={(e) => setHorizonDays(Math.max(1, Number(e.target.value)))}
              />
            </label>
            <label className={styles.label}>
              Minimum notice (hours)
              <input
                className="mc-input"
                type="number"
                min={0}
                max={720}
                value={noticeHours}
                onChange={(e) => setNoticeHours(Math.max(0, Number(e.target.value)))}
              />
            </label>
          </div>
          <div className={styles.actions}>
            <button
              className="mc-btn mc-btn--primary"
              disabled={!valid || busy}
              onClick={onCreate}
              data-testid="booking-link-create"
            >
              Create link
            </button>
          </div>
        </section>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <section>
          <h3 className={styles.subhead}>Your links</h3>
          {links === null && <p className={styles.sub}>Loading…</p>}
          {links?.length === 0 && <p className={styles.sub}>No booking links yet.</p>}
          <ul className={styles.list}>
            {links?.map((link) => (
              <li key={link.linkId} className={styles.item}>
                <div>
                  <div className={styles.itemTitle}>
                    {link.title} · {link.durationMinutes} min
                    <span className={styles.status}>{link.status}</span>
                  </div>
                  {link.booking && link.status === "booked" && (
                    <div className={styles.itemSub}>
                      {link.booking.guestName} ({link.booking.guestEmail}) ·{" "}
                      {formatWhen(link.booking.startMs)}
                    </div>
                  )}
                </div>
                <button
                  className="mc-btn mc-btn--ghost"
                  disabled={busy}
                  onClick={() => onDelete(link)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
