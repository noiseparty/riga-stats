import { addDays, rigaDate, rigaMidnight } from './rigaTime.js';
import type { CheapWindow, PriceDay, PriceHour, PriceSlot, PricesPayload } from './types.js';

/**
 * Nord Pool day-ahead prices for the Latvian bidding zone, as republished by Elering
 * (dashboard.elering.ee/api/nps/price). Shape:
 *   { success: true, data: { lv: [{ timestamp: <unix seconds, slot start>, price: <EUR/MWh> }] } }
 * Since October 2025 the market clears in 15-minute slots, so a normal day has 96 of them
 * (92 or 100 on DST days). Hourly data is still handled: slot length is derived from the
 * gap to the next timestamp.
 */

export interface EleringResponse {
  success?: boolean;
  data?: Record<string, { timestamp: number; price: number }[] | undefined>;
}

export function eleringRange(now: number): { start: string; end: string } {
  const today = rigaDate(now);
  return {
    start: new Date(rigaMidnight(today)).toISOString(),
    end: new Date(rigaMidnight(addDays(today, 2)) - 1).toISOString(),
  };
}

export function toSlots(body: EleringResponse, area = 'lv'): PriceSlot[] {
  const raw = body?.data?.[area];
  if (!Array.isArray(raw)) throw new Error('price feed: no data for area ' + area);
  const clean = raw
    .filter((r) => r && Number.isFinite(r.timestamp) && Number.isFinite(r.price))
    .map((r) => ({ t: r.timestamp * 1000, p: r.price }))
    .sort((a, b) => a.t - b.t);
  const slots: PriceSlot[] = [];
  for (let i = 0; i < clean.length; i++) {
    const cur = clean[i]!;
    if (i > 0 && clean[i - 1]!.t === cur.t) continue;
    const next = clean[i + 1];
    const prev = slots[slots.length - 1];
    let mins = next ? Math.round((next.t - cur.t) / 60000) : (prev?.mins ?? 15);
    if (mins <= 0 || mins > 60) mins = prev?.mins ?? 15;
    slots.push({ t: cur.t, mins, p: Math.round(cur.p * 100) / 100 });
  }
  return slots;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function hourly(slots: PriceSlot[]): PriceHour[] {
  const byHour = new Map<number, number[]>();
  for (const s of slots) {
    // Riga's offset is a whole number of hours, so UTC hour boundaries are Riga's too.
    const h = Math.floor(s.t / 3600000) * 3600000;
    const list = byHour.get(h);
    if (list) list.push(s.p);
    else byHour.set(h, [s.p]);
  }
  return [...byHour.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, ps]) => ({
      t,
      avg: round2(ps.reduce((a, b) => a + b, 0) / ps.length),
      min: Math.min(...ps),
      max: Math.max(...ps),
    }));
}

export function groupDays(slots: PriceSlot[]): PriceDay[] {
  const byDate = new Map<string, PriceSlot[]>();
  for (const s of slots) {
    const d = rigaDate(s.t);
    const list = byDate.get(d);
    if (list) list.push(s);
    else byDate.set(d, [s]);
  }
  const days: PriceDay[] = [];
  for (const [date, list] of [...byDate.entries()].sort()) {
    const dayLenMin = (rigaMidnight(addDays(date, 1)) - rigaMidnight(date)) / 60000;
    const covered = list.reduce((a, s) => a + s.mins, 0);
    const ps = list.map((s) => s.p);
    days.push({
      date,
      complete: covered >= dayLenMin,
      slots: list,
      hours: hourly(list),
      min: Math.min(...ps),
      max: Math.max(...ps),
      avg: round2(ps.reduce((a, b) => a + b, 0) / ps.length),
    });
  }
  return days;
}

/**
 * Cheapest contiguous block of `windowMin` minutes that starts no earlier than the slot
 * containing `from`. Slots must be back to back; a gap in the data breaks the window.
 */
export function cheapestWindow(slots: PriceSlot[], from: number, windowMin = 180): CheapWindow | null {
  const startIdx = slots.findIndex((s) => s.t + s.mins * 60000 > from);
  if (startIdx < 0) return null;
  let best: CheapWindow | null = null;
  for (let i = startIdx; i < slots.length; i++) {
    let covered = 0;
    let sum = 0;
    let j = i;
    let prevEnd = slots[i]!.t;
    while (j < slots.length && covered < windowMin) {
      const s = slots[j]!;
      if (s.t !== prevEnd) break;
      sum += s.p * s.mins;
      covered += s.mins;
      prevEnd = s.t + s.mins * 60000;
      j++;
    }
    if (covered < windowMin) continue;
    const avg = sum / covered;
    if (!best || avg < best.avg - 1e-9) best = { start: slots[i]!.t, end: prevEnd, avg: round2(avg) };
  }
  return best;
}

export function buildPrices(body: EleringResponse, now: number): PricesPayload {
  const slots = toSlots(body, 'lv');
  if (slots.length === 0) throw new Error('price feed: empty');
  const today = rigaDate(now);
  const days = groupDays(slots).filter((d) => d.date >= today).slice(0, 2);
  // Only offer a partial tomorrow if nothing at all is known about it; a stub of four
  // slots that spill past midnight would otherwise read as "published".
  const shown = days.filter((d) => d.date === today || d.complete);
  const cheapest = cheapestWindow(shown.flatMap((d) => d.slots), now);
  return { area: 'lv', days: shown, cheapest };
}

/** EUR/MWh -> euro cents per kWh. */
export function centsPerKwh(eurMwh: number): number {
  return eurMwh / 10;
}
