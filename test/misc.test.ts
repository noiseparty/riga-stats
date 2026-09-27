import { describe, expect, it } from 'vitest';
import { addDays, rigaDate, rigaMidnight, rigaSecondsOfDay } from '../src/shared/rigaTime';
import { compass, describeCode, normaliseWeather } from '../src/shared/weather';
import { SwrCache, UpstreamError } from '../src/server/cache';
import { TokenBuckets } from '../src/server/rateLimit';

describe('rigaTime', () => {
  it('uses +3 in summer and +2 in winter', () => {
    expect(rigaMidnight('2026-09-28')).toBe(Date.UTC(2026, 8, 27, 21));
    expect(rigaMidnight('2026-12-01')).toBe(Date.UTC(2026, 10, 30, 22));
  });
  it('handles the DST switch day itself', () => {
    expect(rigaMidnight('2026-10-25')).toBe(Date.UTC(2026, 9, 24, 21));
    expect(rigaMidnight('2026-10-26')).toBe(Date.UTC(2026, 9, 25, 22));
  });
  it('reads Riga date and time-of-day regardless of the host timezone', () => {
    const t = Date.UTC(2026, 8, 27, 23, 43, 5); // 02:43:05 on the 28th in Riga
    expect(rigaDate(t)).toBe('2026-09-28');
    expect(rigaSecondsOfDay(t)).toBe(2 * 3600 + 43 * 60 + 5);
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });
});

describe('weather', () => {
  it('maps WMO codes and wind directions', () => {
    expect(describeCode(0).sky).toBe('clear');
    expect(describeCode(63).label).toBe('Rain');
    expect(describeCode(1234).label).toBe('Unknown');
    expect(compass(134)).toBe('SE');
    expect(compass(359)).toBe('N');
  });
  it('starts the hourly strip at the current hour and keeps 24', () => {
    const time = Array.from({ length: 48 }, (_, i) =>
      `2026-09-${i < 24 ? '28' : '29'}T${String(i % 24).padStart(2, '0')}:00`,
    );
    const w = normaliseWeather({
      current: { time: '2026-09-28T02:30', temperature_2m: 10.9, weather_code: 3, is_day: 0 },
      hourly: {
        time,
        temperature_2m: time.map(() => 10),
        weather_code: time.map(() => 3),
        precipitation_probability: time.map(() => null),
        is_day: time.map(() => 0),
      },
      daily: {
        time: ['2026-09-28'],
        temperature_2m_max: [14],
        temperature_2m_min: [8],
        weather_code: [3],
        precipitation_sum: [0],
        sunrise: ['2026-09-28T07:23'],
        sunset: ['2026-09-28T19:08'],
      },
    });
    expect(w.hourly).toHaveLength(24);
    expect(w.hourly[0]!.time).toBe('2026-09-28T02:00');
    expect(w.hourly[0]!.pop).toBeNull();
    expect(w.current.isDay).toBe(false);
  });
  it('rejects a body without the expected sections', () => {
    expect(() => normaliseWeather({ error: true })).toThrow();
  });
});

describe('SwrCache', () => {
  it('serves from cache within the TTL and shares in-flight loads', async () => {
    let t = 0;
    let calls = 0;
    const c = new SwrCache<number>({ ttl: 1000, staleFor: 10_000, now: () => t });
    const load = async () => ++calls;
    const [a, b] = await Promise.all([c.get('k', load), c.get('k', load)]);
    expect(a.value).toBe(1);
    expect(b.value).toBe(1);
    t = 500;
    expect((await c.get('k', load)).value).toBe(1);
    expect(calls).toBe(1);
    t = 1500;
    expect((await c.get('k', load)).value).toBe(2);
  });

  it('serves stale data when the upstream fails, then backs off', async () => {
    let t = 0;
    let calls = 0;
    const c = new SwrCache<string>({ ttl: 1000, staleFor: 10_000, retryAfterError: 5000, now: () => t });
    await c.get('k', async () => 'good');
    t = 2000;
    const failing = async (): Promise<string> => {
      calls++;
      throw new UpstreamError('down');
    };
    expect(await c.get('k', failing)).toMatchObject({ value: 'good', stale: true, fetchedAt: 0 });
    t = 3000;
    await c.get('k', failing);
    expect(calls).toBe(1); // backing off: no second upstream call
    t = 20_000;
    await expect(c.get('k', failing)).rejects.toThrow('down'); // too old to serve
  });
});

describe('TokenBuckets', () => {
  it('allows a burst, then refills over time', () => {
    let t = 0;
    const b = new TokenBuckets(3, 1, 100, () => t);
    expect([b.take('ip'), b.take('ip'), b.take('ip')]).toEqual([0, 0, 0]);
    expect(b.take('ip')).toBeGreaterThan(0);
    expect(b.take('other')).toBe(0);
    t = 1000;
    expect(b.take('ip')).toBe(0);
  });
});
