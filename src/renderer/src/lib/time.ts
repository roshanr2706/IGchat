const LOCALE = 'en-US';
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });
const longDate = new Intl.DateTimeFormat(LOCALE, { month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat(LOCALE, { month: '2-digit', day: '2-digit', year: 'numeric' });
const monthDay = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' });

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function sameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

/** Whole calendar days between ts and now (rounded to survive DST shifts). */
function daysAgo(ts: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
}

export function formatTime(ts: number): string {
  return timeFormat.format(ts);
}

export function formatDayLabel(ts: number, now: number): string {
  const d = daysAgo(ts, now);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return longDate.format(ts);
}

export function formatHeaderTimestamp(ts: number, now: number): string {
  const d = daysAgo(ts, now);
  if (d === 0) return `Today at ${formatTime(ts)}`;
  if (d === 1) return `Yesterday at ${formatTime(ts)}`;
  return `${shortDate.format(ts)} ${formatTime(ts)}`;
}

export function formatRelativeShort(ts: number, now: number): string {
  const s = Math.max(0, now - ts) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return monthDay.format(ts);
}
