import { describe, expect, it } from 'vitest';
import { classifyMode, normaliseDepartures, parseDepartures, secondsUntil } from '../src/shared/departures';

// Captured from saraksti.lv/gpsdata.ashx at 02:43 Riga time, plus two day-time lines.
const SAMPLE = `stop,1290a
stop,1028
nightbus,N22,a-b,97200,71151,Lidosta
stop,5003
nightbus,N22,b-a,96530,71151,Centrs
stop,0722
tram,1,b-a,54210,31234,Imanta
trol,14,a-b,54300,,Mežciems
bus,322,a-b,54400,1664,Jaunciems
garbage line
bus,,a-b,54500,1,Nowhere
`;

describe('parseDepartures', () => {
  const rows = parseDepartures(SAMPLE);
  it('assigns each line to the preceding stop section', () => {
    expect(rows.map((r) => r.stopId)).toEqual(['1028', '5003', '0722', '0722', '0722']);
  });
  it('reads route, destination and seconds', () => {
    expect(rows[0]).toMatchObject({ route: 'N22', destination: 'Lidosta', seconds: 97200, vehicle: '71151' });
    expect(rows[3]).toMatchObject({ transport: 'trol', route: '14', destination: 'Mežciems', vehicle: '' });
  });
  it('drops malformed lines and lines without a route', () => {
    expect(rows.find((r) => r.destination === 'Nowhere')).toBeUndefined();
  });
  it('returns nothing for an empty (night-time) answer', () => {
    expect(parseDepartures('stop,0722\nstop,0709\n')).toEqual([]);
    expect(parseDepartures('')).toEqual([]);
  });
});

describe('classifyMode', () => {
  it('handles both word and numeric codes', () => {
    expect(classifyMode('tram', '1')).toBe('tram');
    expect(classifyMode('3', '7')).toBe('tram');
    expect(classifyMode('trol', '14')).toBe('trol');
    expect(classifyMode('1', '14')).toBe('trol');
    expect(classifyMode('nightbus', 'N22')).toBe('nightbus');
    expect(classifyMode('bus', '22')).toBe('bus');
  });
  it('treats 3xx buses as express', () => {
    expect(classifyMode('bus', '322')).toBe('express');
    expect(classifyMode('bus', '3')).toBe('bus');
  });
});

describe('secondsUntil', () => {
  it('handles service-day times past midnight', () => {
    // 27:00 seen at 02:30 is half an hour away
    expect(secondsUntil(97200, 2 * 3600 + 30 * 60)).toBe(1800);
  });
  it('wraps across midnight the other way', () => {
    // 00:05 seen at 23:50
    expect(secondsUntil(5 * 60, 23 * 3600 + 50 * 60)).toBe(900);
  });
  it('is negative for a departure that just left', () => {
    expect(secondsUntil(54000, 54060)).toBe(-60);
  });
});

describe('normaliseDepartures', () => {
  const now = Date.UTC(2026, 8, 28, 12, 0, 0);
  const nowSod = 15 * 3600; // 15:00 Riga

  it('turns service seconds into epoch ms, sorted, within the horizon', () => {
    const out = normaliseDepartures(parseDepartures(SAMPLE), {
      now,
      nowSecondsOfDay: nowSod,
      platformOf: (id) => (id === '0722' ? 'to centre' : ''),
    });
    expect(out.map((d) => d.route)).toEqual(['1', '14', '322']);
    expect(out[0]!.at).toBe(now + (54210 - nowSod) * 1000);
    expect(out[0]!.platform).toBe('to centre');
    expect(out[2]!.mode).toBe('express');
  });

  it('drops departures that left more than 30 s ago and beyond 90 min', () => {
    const raw = parseDepartures('stop,1\nbus,1,a,53900,1,A\nbus,2,a,53990,2,B\nbus,3,a,60000,3,C\n');
    const out = normaliseDepartures(raw, { now, nowSecondsOfDay: 54000, platformOf: () => '' });
    expect(out.map((d) => d.route)).toEqual(['2']);
  });

  it('dedupes one vehicle listed under two platforms', () => {
    const raw = parseDepartures(['stop,a', 'bus,5,a-b,54100,77,X', 'stop,b', 'bus,5,a-b,54100,77,X'].join('\n'));
    expect(normaliseDepartures(raw, { now, nowSecondsOfDay: 54000, platformOf: () => '' })).toHaveLength(1);
  });
});
