import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildStations,
  findStation,
  parseStopIdList,
  parseStops,
  platformLabel,
  searchStations,
  toAscii,
} from '../src/shared/stops';

const text = readFileSync(new URL('./fixtures/stops-sample.txt', import.meta.url), 'utf8');

describe('parseStops', () => {
  const rows = parseStops(text);

  it('skips the nameless rows before the first name and strips the BOM', () => {
    expect(rows.find((r) => r.id === '5489')).toBeUndefined();
    expect(rows.find((r) => r.id === '5501')).toBeUndefined();
  });

  it('inherits the name from the previous named row', () => {
    expect(rows.find((r) => r.id === '1290b')?.name).toBe('Brīvības piemineklis');
    expect(rows.find((r) => r.id === '2017')?.name).toBe('Centrālā stacija');
  });

  it('scales coordinates from 1e-5 degrees', () => {
    const r = rows.find((x) => x.id === '0722')!;
    expect(r.lat).toBeCloseTo(56.94471, 5);
    expect(r.lng).toBeCloseTo(24.12108, 5);
  });

  it('keeps direction text', () => {
    expect(platformLabel(rows.find((r) => r.id === '2017')!.direction)).toBe('from centre');
    expect(platformLabel(rows.find((r) => r.id === '0075')!.direction)).toBe('to centre');
    expect(platformLabel('')).toBe('');
  });
});

describe('buildStations', () => {
  const stations = buildStations(parseStops(text));

  it('merges platforms of one place even when they sit ~470 m apart end to end', () => {
    const cs = stations.filter((s) => s.name === 'Centrālā stacija');
    expect(cs).toHaveLength(1);
    expect(cs[0]!.stopIds).toEqual(['0075', '0077', '0079', '0709', '0722', '2017', '7980']);
  });

  it('keeps far-apart namesakes apart', () => {
    const extra = parseStops(text + '\n9999;1;;5750000;2500000;;Centrālā stacija\n');
    const cs = buildStations(extra).filter((s) => s.name === 'Centrālā stacija');
    expect(cs).toHaveLength(2);
    expect(findStation(buildStations(extra), 'Centrālā stacija')!.stopIds).toContain('0722');
  });
});

describe('searchStations', () => {
  const stations = buildStations(parseStops(text));

  it('matches without diacritics', () => {
    expect(toAscii('Ģertrūdes')).toBe('gertrudes');
    expect(searchStations(stations, 'brivibas')[0]?.name).toBe('Brīvības piemineklis');
  });

  it('ranks prefix matches first', () => {
    const r = searchStations(stations, 'stac');
    expect(r[0]?.name).toMatch(/^Stacijas/);
  });

  it('ignores queries shorter than two characters', () => {
    expect(searchStations(stations, 'c')).toEqual([]);
  });
});

describe('parseStopIdList', () => {
  it('dedupes and sorts', () => {
    expect(parseStopIdList('0722,0075,0722')).toEqual(['0075', '0722']);
  });
  it('rejects anything that is not a bare id', () => {
    expect(parseStopIdList('../etc')).toBeNull();
    expect(parseStopIdList('07 22')).toBeNull();
    expect(parseStopIdList('0722;rm')).toBeNull();
    expect(parseStopIdList('')).toBeNull();
    expect(parseStopIdList(null)).toBeNull();
  });
  it('caps the list at 12 ids', () => {
    const ids = Array.from({ length: 13 }, (_, i) => String(1000 + i));
    expect(parseStopIdList(ids.join(','))).toBeNull();
    expect(parseStopIdList(ids.slice(0, 12).join(','))).toHaveLength(12);
  });
});
