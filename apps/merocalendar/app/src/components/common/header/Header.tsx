import React, { FC } from 'react';
import Select from '../select/Select';

import { createDate, getNextStartMinutes, shmoment } from '../../../utils/date';
import cn from 'classnames';

import styles from './header.module.scss';
import { IDirections, IModes, TDate } from '../../../types/date';
import { useModal } from '../../../hooks/useModal';

interface IHeaderProps {
  onClickArrow: (direction: IDirections) => void;
  displayedDate: string;
  onChangeOption: (option: IModes) => void;
  selectedOption: string;
  selectedDay: TDate;
}

const modes = ['week', 'month', 'year'];

const Header: FC<IHeaderProps> = ({
  onClickArrow,
  displayedDate,
  onChangeOption,
  selectedOption,
  selectedDay,
}) => {
  const {
    isOpenModalCreateEvent,
    isOpenModalDayInfoEvents,
    isOpenModalEditEvent,
    openModalCreate,
  } = useModal();

  const isBtnCreateEventDisable =
    isOpenModalCreateEvent || isOpenModalDayInfoEvents || isOpenModalEditEvent;

  const changeToPrev = () => onClickArrow('left');
  const changeToNext = () => onClickArrow('right');
  const changeToToday = () => onClickArrow('today');

  const handleOpenModal = () => {
    const date = new Date();
    const { hours, minutes } = createDate({ date: date });
    const startMins = getNextStartMinutes(minutes);
    const selectedDate = shmoment(selectedDay.date)
      .set('hours', hours)
      .set('minutes', startMins + minutes)
      .result();

    openModalCreate({ selectedDate });
  };

  return (
    <header className={styles.header}>
      <button
        className={styles.create__btn}
        onClick={handleOpenModal}
        disabled={isBtnCreateEventDisable}
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
              className={cn('icon-button', styles.navigation__icon)}
              onClick={changeToPrev}
            >
              <i className="fas fa-chevron-left"></i>
            </button>
            <button
              className={cn('icon-button', styles.navigation__icon)}
              onClick={changeToNext}
            >
              <i className="fas fa-chevron-right"></i>
            </button>
          </div>
          <span className={styles.navigation__date}>{displayedDate}</span>
        </div>
      </div>
      <Select
        // @ts-ignore
        onChangeOption={onChangeOption}
        options={modes}
        selectedOption={selectedOption}
      />
    </header>
  );
};

export default Header;
