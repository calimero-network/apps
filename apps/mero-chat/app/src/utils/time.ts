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
