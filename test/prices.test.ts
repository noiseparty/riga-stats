import { describe, expect, it } from 'vitest';
import { buildPrices, centsPerKwh, cheapestWindow, eleringRange, groupDays, hourly, toSlots } from '../src/shared/prices';
import type { PriceSlot } from '../src/shared/types';

const Q = 15 * 60;
/** Riga day 2026-09-28 starts at 2026-09-27T21:00Z (EEST, UTC+3). */
const DAY_START = Date.UTC(2026, 8, 27, 21) / 1000;

function feed(n: number, price: (i: number) => number, start = DAY_START) {
  return { success: true, data: { lv: Array.from({ length: n }, (_, i) => ({ timestamp: start + i * Q, price: price(i) })) } };
}

describe('toSlots', () => {
  it('derives 15-minute slots and rounds prices', () => {
    const s = toSlots(feed(3, (i) => i + 0.123456));
    expect(s.map((x) => x.mins)).toEqual([15, 15, 15]);
    expect(s[0]!.p).toBe(0.12);
    expect(s[0]!.t).toBe(DAY_START * 1000);
  });
  it('still copes with hourly data', () => {
    const body = { data: { lv: [0, 1, 2].map((i) => ({ timestamp: DAY_START + i * 3600, price: 10 })) } };
    expect(toSlots(body).map((x) => x.mins)).toEqual([60, 60, 60]);
  });
  it('throws when the area is missing', () => {
    expect(() => toSlots({ data: {} })).toThrow(/no data/);
  });
});

describe('groupDays / hourly', () => {
  it('groups by Riga calendar day and flags completeness', () => {
    // 96 slots of today plus 4 spilling into tomorrow: what Elering returns before
    // tomorrow is published.
    const days = groupDays(toSlots(feed(100, () => 50)));
    expect(days.map((d) => [d.date, d.complete, d.slots.length])).toEqual([
      ['2026-09-28', true, 96],
      ['2026-09-29', false, 4],
    ]);
    expect(days[0]!.hours).toHaveLength(24);
  });
  it('averages quarters into hours', () => {
    const h = hourly(toSlots(feed(4, (i) => [10, 20, 30, 40][i]!)));
    expect(h).toEqual([{ t: DAY_START * 1000, avg: 25, min: 10, max: 40 }]);
  });
  it('knows the October DST day is 100 slots long', () => {
    // 2026-10-25: EEST -> EET; the day starts 2026-10-24T21:00Z and lasts 25 hours.
    const start = Date.UTC(2026, 9, 24, 21) / 1000;
    const days = groupDays(toSlots(feed(100, () => 1, start)));
    expect(days).toHaveLength(1);
    expect(days[0]!.date).toBe('2026-10-25');
    expect(days[0]!.complete).toBe(true);
  });
});

describe('cheapestWindow', () => {
  const slots: PriceSlot[] = Array.from({ length: 96 }, (_, i) => ({
    t: (DAY_START + i * Q) * 1000,
    mins: 15,
    // a cheap valley in slots 40-51 (10:00-13:00 Riga), negative at 44
    p: i >= 40 && i < 52 ? (i === 44 ? -5 : 2) : 80,
  }));

  it('finds the cheapest contiguous 3 hours', () => {
    const w = cheapestWindow(slots, DAY_START * 1000)!;
    expect(w.start).toBe(slots[40]!.t);
    expect(w.end).toBe(slots[52]!.t);
    expect(w.avg).toBeCloseTo((11 * 2 - 5) / 12, 2);
  });

  it('only considers windows from the current slot on', () => {
    const w = cheapestWindow(slots, slots[45]!.t + 60_000)!;
    expect(w.start).toBe(slots[45]!.t);
  });

  it('returns null when fewer than 3 hours remain', () => {
    expect(cheapestWindow(slots, slots[90]!.t)).toBeNull();
  });

  it('does not bridge a gap in the data', () => {
    const gappy = slots.filter((_, i) => i !== 46);
    const w = cheapestWindow(gappy, DAY_START * 1000)!;
    expect(w.start < slots[46]!.t && w.end > slots[46]!.t).toBe(false);
  });
});

describe('buildPrices', () => {
  it('hides a stub tomorrow and keeps a complete one', () => {
    const now = (DAY_START + 3600) * 1000;
    expect(buildPrices(feed(100, () => 40), now).days).toHaveLength(1);
    expect(buildPrices(feed(192, () => 40), now).days).toHaveLength(2);
  });
  it('asks Elering for Riga midnight through the end of tomorrow', () => {
    expect(eleringRange(Date.UTC(2026, 8, 28, 10))).toEqual({
      start: '2026-09-27T21:00:00.000Z',
      end: '2026-09-29T20:59:59.999Z',
    });
  });
  it('converts EUR/MWh to c/kWh', () => {
    expect(centsPerKwh(102.49)).toBeCloseTo(10.249, 3);
  });
});
