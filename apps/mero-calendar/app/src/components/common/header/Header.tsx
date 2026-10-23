import { FC } from "react";

import { IDirections, IModes } from "../../../types/date";
import Select from "../select/Select";
import ThemeToggle from "../theme-toggle/ThemeToggle";
import LogoutButton from "../logout-button/LogoutButton";
import CalendarLogo from "../logo/CalendarLogo";

import styles from "./header.module.scss";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons/Icons";

interface IHeaderProps {
  onClickArrow: (direction: IDirections) => void;
  displayedDate: string;
  onChangeOption: (option: IModes) => void;
  selectedOption: string;
  onBack?: () => void;
  /** Opens the booking links; absent where they cannot be made (an account). */
  onOpenBookingLinks?: () => void;
}

const modes = ["week", "month", "year"];

/**
 * The calendar's floating top bar: where you are (back to the team, the
 * period on screen), how to move (Today, previous / next, the view), and the
 * session (theme, Log out). "Add event" lives at the top of the sidebar, or as
 * the floating button on a phone (see CalendarSidebar).
 */
const Header: FC<IHeaderProps> = ({
  onClickArrow,
  displayedDate,
  onChangeOption,
  selectedOption,
  onBack,
  onOpenBookingLinks,
}) => {
  const changeToPrev = () => onClickArrow("left");
  const changeToNext = () => onClickArrow("right");
  const changeToToday = () => onClickArrow("today");

  return (
    <header className={styles.header}>
      <div className={styles.lead}>
        <span className={styles.mark} aria-hidden>
          <CalendarLogo size={22} color="var(--accent)" />
        </span>
        {onBack && (
          <button
            type="button"
            className={styles.back}
            onClick={onBack}
            title="Back to the team's calendars"
          >
            <ChevronLeftIcon size={16} />
            Teams
          </button>
        )}
      </div>

      <button type="button" className={styles.today} onClick={changeToToday}>
        Today
      </button>
      <div className={styles.arrows}>
        <button
          type="button"
          className={styles.arrow}
          onClick={changeToPrev}
          aria-label="Previous"
        >
          <ChevronLeftIcon size={18} />
        </button>
        <button
          type="button"
          className={styles.arrow}
          onClick={changeToNext}
          aria-label="Next"
        >
          <ChevronRightIcon size={18} />
        </button>
      </div>
      <h1 className={styles.title}>{displayedDate}</h1>

      <div className={styles.view}>
        <Select
          onChangeOption={(option) => onChangeOption(option as IModes)}
          options={modes}
          selectedOption={selectedOption}
        />
      </div>
      <div className={styles.session}>
        {onOpenBookingLinks && (
          <button
            type="button"
            className={styles.today}
            onClick={onOpenBookingLinks}
            data-testid="open-booking-links"
          >
            Booking links
          </button>
        )}
        <ThemeToggle />
        {/* ⚠️ Was a copy icon next to a truncated account id ("b627…f78a"),
            and clicking the ID logged you out — announced only by a `title`
            tooltip nobody hovers. A control has to say what it does, and it is
            the same LogoutButton every signed-in page ends its top bar with. */}
        <LogoutButton />
      </div>
    </header>
  );
};

export default Header;
