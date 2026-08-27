import React, { FC } from "react";
import styles from './time-option.module.scss';
import { formatDifferenceOfTwoTimes } from "../../../../../../utils/date";

interface ITimeOptionsProps {
  hours: string;
  mins: string;
  indx: number;
  selectedOptionId: number;
  isToday: boolean;
  isFullDay: boolean;
  timeFrom: string;
  locale: string;
  setSelectedOptionId: (optiondId: number) => void;
  selectTime: (time: string) => void;
  closeOptions: () => void;
}

const TimeOption: FC<ITimeOptionsProps> = ({
  hours,
  mins,
  indx,
  selectedOptionId,
  isToday,
  isFullDay,
  timeFrom,
  locale,
  setSelectedOptionId,
  selectTime,
  closeOptions
}) => {
  const time = `${hours}:${mins}`;

  const onClick = () => {
    setSelectedOptionId(indx);
    selectTime(time);
    closeOptions();
  }

  return (
  <div
    className={styles.option}
    key={`${hours}-${mins}-${indx}`}
    aria-selected={selectedOptionId === indx}
    onClick={onClick}
  >
    {
      isToday && !isFullDay
        ? `${time} (${formatDifferenceOfTwoTimes(timeFrom, time, locale)})`
        : time
    }
  </div>
  );
}

export default TimeOption;