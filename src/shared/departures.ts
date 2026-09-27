import type { Departure, Mode } from './types.js';

/**
 * Parser for the realtime departures feed behind saraksti.lv (gpsdata.ashx?stopid=...).
 *
 * The response is plain text. Each requested stop opens a section with `stop,<id>`, and
 * every line after it until the next section is one predicted departure:
 *
 *   transport,route,directionType,secondsSinceMidnight,vehicleId,destination[,...]
 *   tram,1,b-a,54210,31234,Imanta
 *
 * Seconds count from the start of the *service day*, so a night bus at 03:00 reads as
 * 97200 (27:00). Normalising against the current Riga time-of-day handles both that and
 * the midnight wrap.
 */

export interface RawDeparture {
  stopId: string;
  transport: string;
  route: string;
  direction: string;
  seconds: number;
  vehicle: string;
  destination: string;
}

export function parseDepartures(text: string): RawDeparture[] {
  const out: RawDeparture[] = [];
  let stopId = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const f = line.split(',');
    if (f[0] === 'stop') {
      stopId = (f[1] ?? '').trim();
      continue;
    }
    if (!stopId || f.length < 4) continue;
    const seconds = Number(f[3]);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 2 * 86400) continue;
    const route = (f[1] ?? '').trim();
    if (!route) continue;
    out.push({
      stopId,
      transport: (f[0] ?? '').trim(),
      route,
      direction: (f[2] ?? '').trim(),
      seconds,
      vehicle: (f[4] ?? '').trim(),
      destination: (f[5] ?? '').trim(),
    });
  }
  return out;
}

/**
 * Numeric codes appear in the GPS feed ('1' trolleybus, '3' tram, '7' night bus), words
 * in the departures feed. Accept both. Routes 3xx are express buses in Riga.
 */
export function classifyMode(transport: string, route: string): Mode {
  const t = transport.toLowerCase();
  let mode: Mode;
  if (t === 'tram' || t === '3') mode = 'tram';
  else if (t === 'trol' || t === 'trolleybus' || t === '1') mode = 'trol';
  else if (t === 'nightbus' || t === '7' || /^n\d/i.test(route)) mode = 'nightbus';
  else if (t === 'bus' || t === '2' || t === 'expressbus' || t === 'minibus') mode = 'bus';
  else mode = 'other';
  if (mode === 'bus' && /^3\d\d$/.test(route)) mode = 'express';
  return mode;
}

/**
 * Seconds from now until a departure at `depSeconds` (service-day clock), given the
 * current Riga time-of-day. Folds into (-12h, +12h] so a 27:00 departure seen at 02:30 is
 * 30 minutes away, and 00:05 seen at 23:50 is 15 minutes away.
 */
export function secondsUntil(depSeconds: number, nowSecondsOfDay: number): number {
  let diff = depSeconds - nowSecondsOfDay;
  while (diff <= -43200) diff += 86400;
  while (diff > 43200) diff -= 86400;
  return diff;
}

export interface NormaliseOptions {
  now: number;
  nowSecondsOfDay: number;
  platformOf: (stopId: string) => string;
  /** Drop anything that left more than this long ago. */
  pastSec?: number;
  /** And anything further out than this. */
  horizonSec?: number;
  limit?: number;
}

export function normaliseDepartures(raw: RawDeparture[], o: NormaliseOptions): Departure[] {
  const past = o.pastSec ?? 30;
  const horizon = o.horizonSec ?? 90 * 60;
  const seen = new Set<string>();
  const out: Departure[] = [];
  for (const r of raw) {
    const diff = secondsUntil(r.seconds, o.nowSecondsOfDay);
    if (diff < -past || diff > horizon) continue;
    // The same vehicle can be listed under two platforms of one station; keep one.
    const dedupe = `${r.route}|${r.vehicle}|${r.seconds}|${r.destination}`;
    if (r.vehicle && seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      stopId: r.stopId,
      mode: classifyMode(r.transport, r.route),
      route: r.route,
      destination: r.destination || '—',
      at: o.now + diff * 1000,
      platform: o.platformOf(r.stopId),
      vehicle: r.vehicle,
    });
  }
  out.sort((a, b) => a.at - b.at || a.route.localeCompare(b.route, 'lv', { numeric: true }));
  return out.slice(0, o.limit ?? 40);
}
