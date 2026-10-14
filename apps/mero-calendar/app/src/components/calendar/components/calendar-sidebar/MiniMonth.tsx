import { FC, useEffect, useMemo, useState } from "react";
import cn from "classnames";

import { IEvent } from "../../../../types/event";
import {
  checkDateIsEqual,
  checkIsToday,
  getCalendarDaysOfMonth,
  getWeekDaysNames,
} from "../../../../utils/date";
import { ChevronLeftIcon, ChevronRightIcon } from "../../../common/icons/Icons";

import styles from "./calendar-sidebar.module.scss";

interface IMiniMonthProps {
  selectedDate: Date;
  events: IEvent[];
  onSelectDate: (date: Date) => void;
}

// Monday first, as the main grids are (useCalendar's firstWeekDayNumber).
const FIRST_WEEK_DAY = 2;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * The sidebar's month at a glance. Browsing it (its own arrows) does not move
 * the main calendar; picking a day does. Days with an event carry a dot.
 */
const MiniMonth: FC<IMiniMonthProps> = ({ selectedDate, events, onSelectDate }) => {
  const [shown, setShown] = useState({
    year: selectedDate.getFullYear(),
    monthIndex: selectedDate.getMonth(),
  });

  // Follow the main calendar when it moves to another month.
  useEffect(() => {
    setShown({ year: selectedDate.getFullYear(), monthIndex: selectedDate.getMonth() });
  }, [selectedDate]);

  const days = useMemo(
    () =>
      getCalendarDaysOfMonth({
        year: shown.year,
        monthIndex: shown.monthIndex,
        firstWeekDayNumber: FIRST_WEEK_DAY,
      }),
    [shown],
  );
  const weekDays = useMemo(() => getWeekDaysNames(FIRST_WEEK_DAY), []);
  const busy = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) set.add(dayKey(new Date(e.start)));
    return set;
  }, [events]);

  const step = (by: number) => {
    const d = new Date(shown.year, shown.monthIndex + by, 1);
    setShown({ year: d.getFullYear(), monthIndex: d.getMonth() });
  };

  const label = new Date(shown.year, shown.monthIndex, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  return (
    <section className={styles.mini} aria-label="Month at a glance">
      <div className={styles.mini__head}>
        <span className={styles.mini__label}>{label}</span>
        <button
          type="button"
          className={styles.mini__arrow}
          onClick={() => step(-1)}
          aria-label="Previous month"
        >
          <ChevronLeftIcon size={16} />
        </button>
        <button
          type="button"
          className={styles.mini__arrow}
          onClick={() => step(1)}
          aria-label="Next month"
        >
          <ChevronRightIcon size={16} />
        </button>
      </div>
      <div className={styles.mini__grid}>
        {weekDays.map((w) => (
          <span key={w.day} className={styles.mini__weekday}>
            {w.dayShort.slice(0, 2)}
          </span>
        ))}
        {days.map((day) => (
          <button
            type="button"
            key={`${day.year}-${day.monthIndex}-${day.dayNumber}`}
            className={cn(styles.mini__day, {
              [styles.mini__day_outside]: day.monthIndex !== shown.monthIndex,
              [styles.mini__day_selected]: checkDateIsEqual(day.date, selectedDate),
              [styles.mini__day_today]: checkIsToday(day.date),
            })}
            onClick={() => onSelectDate(day.date)}
          >
            {day.dayNumber}
            {busy.has(dayKey(day.date)) && <span className={styles.mini__dot} />}
          </button>
        ))}
      </div>
    </section>
  );
};

export default MiniMonth;
