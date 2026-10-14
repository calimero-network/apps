import { CSSProperties, FC, MouseEvent, useMemo } from "react";

import { TDate } from "../../../../types/date";
import { IEvent } from "../../../../types/event";
import { useModal } from "../../../../hooks/useModal";
import { usePopup } from "../../../../hooks/usePopup";
import { useTypedSelector } from "../../../../hooks/useTypedSelector";
import { useMembers } from "../../../../hooks/useMembers";
import { accountId } from "../../../../api/identity";
import { createDate, formatDate, getNextStartMinutes, shmoment } from "../../../../utils/date";
import { LockIcon, PlusIcon } from "../../../common/icons/Icons";
import MiniMonth from "./MiniMonth";

import styles from "./calendar-sidebar.module.scss";

interface ICalendarSidebarProps {
  selectedDay: TDate;
  onSelectDate: (date: Date) => void;
}

/** The people list stops here; the rest are a count. */
const PEOPLE_SHOWN = 6;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** A stable hue per member, so a person keeps their colour across visits. */
function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/**
 * The calendar's left rail: the primary action, the month at a glance, what is
 * on today, and who shares this calendar.
 *
 * On a phone the rail folds away (`display: contents`) and only "Add event"
 * stays, as a floating button. That button is `position: fixed`, which is why
 * nothing above it — this rail on a phone, the page shell — may carry a
 * `backdrop-filter`, `filter` or `transform`: any of those would become its
 * containing block and pin it inside the rail instead of the viewport.
 */
const CalendarSidebar: FC<ICalendarSidebarProps> = ({ selectedDay, onSelectDate }) => {
  const { events } = useTypedSelector(({ events }) => events);
  const { members, displayName } = useMembers();
  const { openPopup } = usePopup();
  const {
    isOpenModalCreateEvent,
    isOpenModalDayInfoEvents,
    isOpenModalEditEvent,
    openModalCreate,
  } = useModal();
  const isBtnCreateEventDisable =
    isOpenModalCreateEvent || isOpenModalDayInfoEvents || isOpenModalEditEvent;
  const me = accountId();

  // Moved here from the top bar unchanged: a new event starts on the day the
  // calendar is showing, at the next free slot after the current time.
  const handleOpenModal = () => {
    const date = new Date();
    const { hours, minutes } = createDate({ date: date });
    const startMins = getNextStartMinutes(minutes);
    const selectedDate = shmoment(selectedDay.date)
      .set("hours", hours)
      .set("minutes", startMins + minutes)
      .result();

    openModalCreate({ selectedDate });
  };

  const today = useMemo(() => {
    const from = startOfDay(new Date()).getTime();
    const to = from + 24 * 60 * 60 * 1000;
    return (events as IEvent[])
      .filter((e) => {
        const s = new Date(e.start).getTime();
        const en = new Date(e.end).getTime();
        return s < to && en >= from;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [events]);

  const openEvent = (e: MouseEvent<HTMLButtonElement>, id: string) => {
    e.stopPropagation();
    openPopup({ x: e.clientX, y: e.clientY, eventId: id });
  };

  const timeOf = (e: IEvent) =>
    e.type === "long-event"
      ? "All day"
      : `${formatDate(new Date(e.start), "hh:mm")} – ${formatDate(new Date(e.end), "hh:mm")}`;

  return (
    <aside className={styles.sidebar}>
      <button
        type="button"
        className={styles.add}
        onClick={handleOpenModal}
        disabled={isBtnCreateEventDisable}
        data-testid="add-event-btn"
      >
        <PlusIcon size={18} />
        Add event
      </button>

      <div className={styles.panels}>
        <MiniMonth
          selectedDate={selectedDay.date}
          events={events as IEvent[]}
          onSelectDate={onSelectDate}
        />

        <section className={styles.section} aria-label="Today">
          <h2 className={styles.section__title}>Today</h2>
          {today.length === 0 ? (
            <p className={styles.empty}>Nothing scheduled. Enjoy the space.</p>
          ) : (
            <div className={styles.agenda}>
              {today.map((e) => (
                <button
                  type="button"
                  key={e.id}
                  className={styles.agenda__item}
                  style={{ "--ev": e.color } as CSSProperties}
                  onClick={(ev) => openEvent(ev, e.id)}
                >
                  <span className={styles.agenda__bar} />
                  <span className={styles.agenda__text}>
                    <span className={styles.agenda__title}>
                      {e.private && <LockIcon title="Private event" size={12} />}
                      {e.title}
                    </span>
                    <span className={styles.agenda__time}>{timeOf(e)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className={styles.section} aria-label="People">
          <h2 className={styles.section__title}>
            People <span className={styles.count}>{members.length}</span>
          </h2>
          {members.length === 0 ? (
            <p className={styles.empty}>Invite your team from the Teams page.</p>
          ) : (
            <div className={styles.people}>
              {members.slice(0, PEOPLE_SHOWN).map((m) => {
                const name = displayName(m.id);
                return (
                  <div className={styles.person} key={m.id} title={m.id}>
                    <span
                      className={styles.avatar}
                      style={{ "--hue": hueOf(m.id) } as CSSProperties}
                      aria-hidden
                    >
                      {name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className={styles.person__name}>{name}</span>
                    {m.id === me && <span className={styles.you}>You</span>}
                  </div>
                );
              })}
              {members.length > PEOPLE_SHOWN && (
                <p className={styles.empty}>+{members.length - PEOPLE_SHOWN} more</p>
              )}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};

export default CalendarSidebar;
