
/**
* Returns:
* For today: Time, e.g. "15:23"
* This week: Weekday, Time, e.g. "Wed 15:23"
* Other this year: Date without year and time, e.g. "23.11. 15:23"
* Other: Date and time, e.g. "23.11.2018 15:23"
* Each in locale
* See also <https://momentjs.com> for relative time
*/
export function getDateString(date: Date): string {
  var dateDetails = null;
  let today = new Date();
  if (date.getDate() == today.getDate() && today.getTime() - date.getTime() < 24 * 60 * 60 * 1000) {
    dateDetails = { hour: "numeric", minute: "numeric" };
  } else if (today.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) { // this week
    dateDetails = { weekday: "short", hour: "numeric", minute: "numeric" };
  } else if (date.getFullYear() == today.getFullYear()) { // this year
    dateDetails = { month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" };
  } else {
    dateDetails = { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" };
  }
  return date.toLocaleString(navigator.language, dateDetails);
}

export function getToday() {
  const today = new Date();
  today.setHours(0);
  today.setMinutes(0);
  today.setSeconds(0);
  today.setMilliseconds(0);
  return today;
}
