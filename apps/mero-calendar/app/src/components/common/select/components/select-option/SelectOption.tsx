import React, { FC } from "react";
import cn from "classnames";

import styles from './select-option.module.scss';
import { CheckIcon } from "../../../icons/Icons";

interface ISelectOptionProps {
  option: string;
  selected?: boolean;
  close: () => void;
  onChangeOption: (option: string) => void;
}

const SelectOption: FC<ISelectOptionProps> = ({
  option,
  selected = false,
  close,
  onChangeOption
}) => {
  const onOptionClicked = () => {
    close();
    onChangeOption(option);
  };

  return (
    <li
      className={cn(styles.option, { [styles.option_selected]: selected })}
      onClick={onOptionClicked}
    >
      <span className={styles.option__check}>
        {selected && <CheckIcon size={16} />}
      </span>
      <div className={styles.option__name}>{option}</div>
      <div className={styles.option__symbol}>{option.slice(0, 1)}</div>
    </li>
  );
}

export default SelectOption;
