const londonDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function londonCalendarDate(value: Date) {
  const parts = Object.fromEntries(
    londonDateFormatter.formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * TikTok Shop's video-performance endpoint requires an inclusive start date
 * and exclusive end date in the shop's reporting timezone. Keep the initial
 * reporting window aligned with the affiliate-order baseline.
 */
export function tiktokAffiliateAnalyticsWindow(now = new Date(), lookbackDays = 90) {
  const today = londonCalendarDate(now);
  return {
    startDateGe: addCalendarDays(today, -lookbackDays),
    endDateLt: addCalendarDays(today, 1),
  };
}
