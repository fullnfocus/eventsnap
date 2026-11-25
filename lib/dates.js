// Year inference for posters that print a date without a year (e.g. "21/11").
// Rule: choose the year that puts the date CLOSEST to the reference date (today, or the day the poster was
// collected). A recent past date therefore stays in the past (the event is probably over) instead of jumping
// to next year. Done in code, not by the LLM, so it is deterministic and explainable.

export function closestYearDate(dateStr, refDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m || !refDate) return dateStr;
  const [, , mm, dd] = m;
  const ref = new Date(`${refDate}T00:00:00Z`);
  const y0 = ref.getUTCFullYear();
  let best = null;
  for (const y of [y0 - 1, y0, y0 + 1]) {
    const d = new Date(`${y}-${mm}-${dd}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(5, 10) !== `${mm}-${dd}`) continue; // e.g. 29 Feb
    const diff = Math.abs(d - ref);
    if (!best || diff < best.diff) best = { diff, date: `${y}-${mm}-${dd}` };
  }
  return best ? best.date : dateStr;
}

export function applyYearRule(event, refDate) {
  if (event.year_printed !== false) return event; // year printed on the poster (or unknown): keep it
  return {
    ...event,
    start_date: closestYearDate(event.start_date, refDate),
    end_date: event.end_date ? closestYearDate(event.end_date, refDate) : event.end_date,
  };
}
