export const INDIA_TIME_ZONE = 'Asia/Kolkata';

type DateValue = string | number | Date;

function asDate(value: DateValue): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const indiaDateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: INDIA_TIME_ZONE,
  dateStyle: 'medium',
});

const indiaDateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: INDIA_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

const indiaTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: INDIA_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
});

function indiaDayNumber(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) / 86_400_000;
}

export function formatIndiaDate(value: DateValue): string {
  const date = asDate(value);
  return date ? indiaDateFormatter.format(date) : 'Date unavailable';
}

export function formatIndiaDateTime(value: DateValue): string {
  const date = asDate(value);
  return date ? indiaDateTimeFormatter.format(date) : 'Date unavailable';
}

export function formatIndiaTime(value: DateValue): string {
  const date = asDate(value);
  return date ? indiaTimeFormatter.format(date) : '';
}

export function formatRelativeIndiaTime(value: DateValue, now = new Date()): string {
  const date = asDate(value);
  if (!date) return 'Date unavailable';

  const elapsedMs = now.getTime() - date.getTime();
  if (elapsedMs < 60_000) return 'just now';

  const daysAgo = indiaDayNumber(now) - indiaDayNumber(date);
  if (daysAgo <= 0) {
    const minutes = Math.floor(elapsedMs / 60_000);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  }
  if (daysAgo === 1) return `Yesterday, ${formatIndiaTime(date)}`;
  if (daysAgo < 7) return `${daysAgo}d ago`;
  return formatIndiaDate(date);
}
