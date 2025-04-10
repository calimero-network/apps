import { IMapEventValues, IModalValues } from "./types";
import { colors } from "../form-elements/color-picker/colors";
import { formatDate } from "../../../utils/date";

export const getMapEventValues = ({
  title,
  description,
  peers,
  startDate,
  endDate,
  type,
  color = colors[0]
}: IMapEventValues): IModalValues => {
  return {
    title,
    peers,
    startDate,
    endDate,
    startTime: formatDate(startDate, `hh:mm`),
    endTime: formatDate(endDate, `hh:mm`),
    description,
    isLongEvent: type === 'long-event',
    color
  }
}