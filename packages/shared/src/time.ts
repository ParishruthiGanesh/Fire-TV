import { WEEKDAY_KEYS, type WeekdayKey } from './domain.js';

/**
 * Household timezone handling.
 *
 * Alongside stores schedules as a local wall-clock time plus an IANA timezone,
 * and resolves them to instants on demand. That way "breakfast at 08:00" stays
 * 08:00 for the person across a daylight-saving change, and a postponement
 * stored as an instant survives one.
 *
 * Everything here uses `Intl` so there is no timezone database dependency.
 */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: WeekdayKey;
}

const WEEKDAY_FROM_SHORT: Record<string, WeekdayKey> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
};

export function zonedParts(instant: Date | string | number, timeZone: string): ZonedParts {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_FROM_SHORT[get('weekday')] ?? 'mon',
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (east positive). */
export function timezoneOffsetMs(instant: Date | number, timeZone: string): number {
  const date = instant instanceof Date ? instant : new Date(instant);
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Ignore sub-second drift: schedules are minute-resolution.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** "YYYY-MM-DD" for an instant, in the given timezone. */
export function localDateInZone(instant: Date | string | number, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** "HH:MM" for an instant, in the given timezone. */
export function localTimeInZone(instant: Date | string | number, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

export function weekdayInZone(instant: Date | string | number, timeZone: string): WeekdayKey {
  return zonedParts(instant, timeZone).weekday;
}

/**
 * Resolve a local wall-clock date and time in `timeZone` to a UTC instant.
 * Converges in at most three passes, which covers DST transitions.
 */
export function zonedTimeToInstant(localDate: string, localTime: string, timeZone: string): Date {
  const [y, m, d] = localDate.split('-').map(Number);
  const [hh, mm] = localTime.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0);
  let guess = wall;
  for (let i = 0; i < 3; i += 1) {
    const offset = timezoneOffsetMs(guess, timeZone);
    const next = wall - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** Add days to a "YYYY-MM-DD" local date string. */
export function addLocalDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return `${pad4(base.getUTCFullYear())}-${pad2(base.getUTCMonth() + 1)}-${pad2(base.getUTCDate())}`;
}

export function weekdayOfLocalDate(localDate: string): WeekdayKey {
  const [y, m, d] = localDate.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return WEEKDAY_KEYS[(dow + 6) % 7];
}

/** "8:00 AM" — used on the TV and in spoken text. */
export function friendlyTime(localTime: string): string {
  const [hh, mm] = localTime.split(':').map(Number);
  const suffix = hh < 12 ? 'AM' : 'PM';
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour12}:${pad2(mm)} ${suffix}`;
}

/** "eight o'clock" / "eight thirty" — reads better than "08:30" aloud. */
export function spokenTime(localTime: string): string {
  const [hh, mm] = localTime.split(':').map(Number);
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  const names = [
    'twelve', 'one', 'two', 'three', 'four', 'five',
    'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  ];
  const hourWord = names[hour12 % 12];
  const partOfDay = hh < 12 ? 'in the morning' : hh < 18 ? 'in the afternoon' : 'in the evening';
  if (mm === 0) return `${hourWord} o'clock ${partOfDay}`;
  if (mm === 30) return `${hourWord} thirty ${partOfDay}`;
  if (mm === 15) return `quarter past ${hourWord} ${partOfDay}`;
  if (mm === 45) return `quarter to ${names[(hour12 + 1) % 12]} ${partOfDay}`;
  return `${hourWord} ${mm < 10 ? `oh ${mm}` : mm} ${partOfDay}`;
}

export function describeDays(days: WeekdayKey[]): string {
  const set = new Set(days);
  const weekdays: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const weekend: WeekdayKey[] = ['sat', 'sun'];
  if (days.length === 7) return 'Every day';
  if (weekdays.every((d) => set.has(d)) && !weekend.some((d) => set.has(d))) return 'Weekdays';
  if (weekend.every((d) => set.has(d)) && days.length === 2) return 'Weekends';
  const order: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const short: Record<WeekdayKey, string> = {
    mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
  };
  return order.filter((d) => set.has(d)).map((d) => short[d]).join(', ');
}

/** Greeting band for the TV header. */
export function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function pad4(n: number): string {
  return String(n).padStart(4, '0');
}
