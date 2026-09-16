import { FC } from "react";

import { useMero } from "@calimero-network/mero-react";
import cn from "classnames";

import { IDirections, IModes, TDate } from "../../../types/date";
import { useModal } from "../../../hooks/useModal";
import { createDate, getNextStartMinutes, shmoment } from "../../../utils/date";
import Select from "../select/Select";
import ThemeToggle from "../theme-toggle/ThemeToggle";

import styles from "./header.module.scss";
import { useNavigate } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons/Icons";

interface IHeaderProps {
  onClickArrow: (direction: IDirections) => void;
  displayedDate: string;
  onChangeOption: (option: IModes) => void;
  selectedOption: string;
  selectedDay: TDate;
  onBack?: () => void;
}

const modes = ["week", "month", "year"];

const Header: FC<IHeaderProps> = ({
  onClickArrow,
  displayedDate,
  onChangeOption,
  selectedOption,
  selectedDay,
  onBack,
}) => {
  const { logout } = useMero();
  const navigate = useNavigate();
  const {
    isOpenModalCreateEvent,
    isOpenModalDayInfoEvents,
    isOpenModalEditEvent,
    openModalCreate,
  } = useModal();
  const isBtnCreateEventDisable =
    isOpenModalCreateEvent || isOpenModalDayInfoEvents || isOpenModalEditEvent;

  const changeToPrev = () => onClickArrow("left");
  const changeToNext = () => onClickArrow("right");
  const changeToToday = () => onClickArrow("today");

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

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <header className={styles.header}>
      {onBack && (
        <button className={styles.back} onClick={onBack} title="Back to teams">
          ← Teams
        </button>
      )}
      <button
        className={styles.create__btn}
        onClick={handleOpenModal}
        disabled={isBtnCreateEventDisable}
        data-testid="add-event-btn"
      >
        Add event
      </button>
      <div className={styles.navigation}>
        <button
          className={cn(styles.navigation__today__btn, "button")}
          onClick={changeToToday}
        >
          Today
        </button>
        <div className={styles.navigation__body}>
          <div className={styles.navigation__icons}>
            <button
              className={cn("icon-button", styles.navigation__icon)}
              onClick={changeToPrev}
            >
              <ChevronLeftIcon />
            </button>
            <button
              className={cn("icon-button", styles.navigation__icon)}
              onClick={changeToNext}
            >
              <ChevronRightIcon />
            </button>
          </div>
          <span className={styles.navigation__date}>{displayedDate}</span>
        </div>
      </div>
      <Select
        // @ts-ignore — Select expects a stricter option union
        onChangeOption={onChangeOption}
        options={modes}
        selectedOption={selectedOption}
      />
      <div className={styles.headerRight}>
        <ThemeToggle />
        {/* ⚠️ Was a copy icon next to a truncated account id ("b627…f78a"),
            and clicking the ID logged you out — announced only by a `title`
            tooltip nobody hovers. A control has to say what it does. The
            teams pages already end their header with exactly this button, so
            logging out is now the same gesture everywhere. */}
        <button
          className="mc-btn mc-btn--ghost"
          onClick={handleLogout}
          data-testid="logout-btn"
        >
          Logout
        </button>
      </div>
    </header>
  );
};

export default Header;
