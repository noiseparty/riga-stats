/**
 * Everything on the board is in Riga wall-clock time, whatever timezone the server or the
 * visitor's browser happens to run in. These helpers go through Intl rather than a fixed
 * +02:00/+03:00, so the DST switch in March and October needs no special casing.
 */

export const RIGA_TZ = 'Europe/Riga';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: RIGA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface RigaParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function rigaParts(at: number | Date): RigaParts {
  const out: Record<string, number> = {};
  for (const p of partsFmt.formatToParts(typeof at === 'number' ? new Date(at) : at)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** "2026-09-28" for the Riga calendar day containing `at`. */
export function rigaDate(at: number | Date): string {
  const p = rigaParts(at);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Seconds since Riga midnight, 0..86399. */
export function rigaSecondsOfDay(at: number | Date): number {
  const p = rigaParts(at);
  return p.hour * 3600 + p.minute * 60 + p.second;
}

/** Riga's UTC offset in minutes at the instant `at` (+120 in winter, +180 in summer). */
export function rigaOffsetMinutes(at: number): number {
  const p = rigaParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60000);
}

/** The UTC instant at which the Riga calendar day `ymd` ("2026-09-28") begins. */
export function rigaMidnight(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d);
  // Two passes: the offset at the naive guess can differ from the offset at the answer
  // only on a DST-switch day, and the second pass settles it.
  let guess = naive - rigaOffsetMinutes(naive) * 60000;
  guess = naive - rigaOffsetMinutes(guess) * 60000;
  return guess;
}

/** Adds whole calendar days to a "YYYY-MM-DD" string. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
