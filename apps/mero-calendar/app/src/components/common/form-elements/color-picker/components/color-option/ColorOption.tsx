import React, { FC } from "react";

import styles from './color-option.module.scss';
import { CheckIcon } from "../../../../icons/Icons";

interface IColorOptionProps {
  color: string;
  selectedColor: string;
  onChangeColor: (color: string) => void;
  readOnly?: boolean;
}

const ColorOption: FC<IColorOptionProps> = ({
  color,
  selectedColor,
  onChangeColor,
  readOnly = false
}) => {
  const handleChangeColor = () => {
    if (!readOnly) {
      onChangeColor(color);
    }
  }

  return (
    <div
      className={styles.option}
      onClick={handleChangeColor}
      style={{ background: color }}
    >
      {selectedColor === color && (
        <CheckIcon />
      )}
    </div>
  );
}

export default ColorOption;