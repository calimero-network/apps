export function getDayWithSuffix(day: number) {
  if (day >= 11 && day <= 13) {
    return "th";
  }
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function convertTimestampToDate(timestamp: string) {
  const dateObject = new Date(timestamp);
  const dayWithSuffix = getDayWithSuffix(dateObject.getDate());
  const formattedDate = dateObject.toLocaleDateString("en-US", {
    month: "long",
  });

  return `${formattedDate} ${dateObject.getDate()}${dayWithSuffix}, ${dateObject.getFullYear()}`;
}

export const timestampToDate = (timestampMs: string) => {
  const date = new Date(timestampMs);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const formattedDay = day < 10 ? `0${day}` : `${day}`;
  const formattedMonth = month < 10 ? `0${month}` : `${month}`;
  return `${formattedDay}/${formattedMonth}/${year}`;
};
