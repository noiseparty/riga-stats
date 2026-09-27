import type { Station } from './types.js';

/**
 * Parser for the Rīgas Satiksme stop list (saraksti.lv/riga/stops.txt).
 *
 * Format, semicolon separated, header row first:
 *   ID;SiriID;Direction;Lat;Lng;Stops;Name;Info;Street;Area;City
 * Lat/Lng are integers in 1e-5 degrees. Name is only written on the first row of a run of
 * platforms that share it; the rows after inherit it. That is how the upstream site reads
 * the file too (ti.loadStops), and rows before the first name have none and are skipped.
 */

export interface StopRow {
  id: string;
  direction: string;
  lat: number;
  lng: number;
  name: string;
  street: string;
}

export const STOP_ID_RE = /^[A-Za-z0-9]{1,10}$/;

export function parseStops(text: string): StopRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = (lines[0] ?? '').split(';').map((h) => h.trim().toLowerCase());
  const col = (name: string, fallback: number) => {
    const i = header.indexOf(name);
    return i >= 0 ? i : fallback;
  };
  const F = {
    id: col('id', 0),
    dir: col('direction', 2),
    lat: col('lat', 3),
    lng: col('lng', 4),
    name: col('name', 6),
    street: col('street', 8),
  };

  const out: StopRow[] = [];
  let name = '';
  let street = '';
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const parts = line.split(';');
    const id = (parts[F.id] ?? '').trim();
    if (!STOP_ID_RE.test(id)) continue;

    const rowName = (parts[F.name] ?? '').trim();
    const rowStreet = (parts[F.street] ?? '').trim();
    if (rowName && rowName !== '0') {
      if (rowName !== name) street = '';
      name = rowName;
    }
    if (rowStreet && rowStreet !== '0') street = rowStreet;
    if (!name) continue;

    const lat = Number(parts[F.lat]) / 1e5;
    const lng = Number(parts[F.lng]) / 1e5;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0) continue;

    out.push({ id, direction: (parts[F.dir] ?? '').trim(), lat, lng, name, street });
  }
  return out;
}

/** Lowercase, strip diacritics: "Ģertrūdes" -> "gertrudes". */
export function toAscii(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const RIGA_CENTRE = { lat: 56.9496, lng: 24.1052 };
export const MAX_STOPS_PER_STATION = 12;
const CLUSTER_LINK_M = 400;

export function platformLabel(direction: string): string {
  const d = toAscii(direction);
  if (d.startsWith('uz centru')) return 'to centre';
  if (d.startsWith('no centra')) return 'from centre';
  if (d.startsWith('abi')) return 'both ways';
  return '';
}

/**
 * A "station" is what a person means by a stop: every platform sharing a name within a
 * short walk. Two places can share a name across the city (there is more than one
 * "Dzelzceļa stacija"), so platforms are clustered by distance, not just grouped by name.
 */
export function buildStations(rows: StopRow[]): Station[] {
  const byName = new Map<string, StopRow[]>();
  for (const r of rows) {
    const list = byName.get(r.name);
    if (list) list.push(r);
    else byName.set(r.name, [r]);
  }

  const stations: Station[] = [];
  for (const [name, list] of byName) {
    // Single-linkage: platforms join a cluster if they are within walking distance of
    // any member, so a station spread along a square is not split by visiting order.
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (distanceM(a.lat, a.lng, b.lat, b.lng) <= CLUSTER_LINK_M) parent[find(i)] = find(j);
      }
    }
    const groups = new Map<number, StopRow[]>();
    list.forEach((r, i) => {
      const root = find(i);
      const g = groups.get(root);
      if (g) g.push(r);
      else groups.set(root, [r]);
    });
    const clusters = [...groups.values()].map((rows) => ({
      rows,
      lat: rows.reduce((acc, r) => acc + r.lat, 0) / rows.length,
      lng: rows.reduce((acc, r) => acc + r.lng, 0) / rows.length,
    }));
    for (const c of clusters) {
      const nearest = [...c.rows]
        .sort((a, b) => distanceM(c.lat, c.lng, a.lat, a.lng) - distanceM(c.lat, c.lng, b.lat, b.lng))
        .slice(0, MAX_STOPS_PER_STATION);
      const streets = new Map<string, number>();
      for (const r of nearest) if (r.street) streets.set(r.street, (streets.get(r.street) ?? 0) + 1);
      const street = [...streets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      const stopIds = nearest.map((r) => r.id).sort();
      stations.push({
        key: stopIds[0] ?? name,
        name,
        street,
        lat: Math.round(c.lat * 1e5) / 1e5,
        lng: Math.round(c.lng * 1e5) / 1e5,
        stopIds,
      });
    }
  }
  return stations;
}

export function searchStations(stations: Station[], query: string, limit = 12): Station[] {
  const q = toAscii(query.trim()).replace(/\s+/g, ' ');
  if (q.length < 2) return [];
  const scored: { s: Station; rank: number; dist: number }[] = [];
  for (const s of stations) {
    const n = toAscii(s.name);
    let rank = -1;
    if (n.startsWith(q)) rank = 0;
    else if (n.split(/[\s."'-]+/).some((w) => w.startsWith(q))) rank = 1;
    else if (n.includes(q)) rank = 2;
    else if (toAscii(s.street).includes(q)) rank = 3;
    if (rank < 0) continue;
    scored.push({ s, rank, dist: distanceM(RIGA_CENTRE.lat, RIGA_CENTRE.lng, s.lat, s.lng) });
  }
  scored.sort((a, b) => a.rank - b.rank || a.dist - b.dist || a.s.name.localeCompare(b.s.name));
  return scored.slice(0, limit).map((x) => x.s);
}

/** Of the stations called `name`, the one nearest the centre. */
export function findStation(stations: Station[], name: string): Station | undefined {
  let best: Station | undefined;
  let bestD = Infinity;
  for (const s of stations) {
    if (s.name !== name) continue;
    const d = distanceM(RIGA_CENTRE.lat, RIGA_CENTRE.lng, s.lat, s.lng);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/**
 * Parses the `stops` query parameter: comma separated ids, deduplicated, at most
 * MAX_STOPS_PER_STATION. Returns null if anything in it is malformed; the caller then
 * checks each id against the real stop list.
 */
export function parseStopIdList(raw: string | null | undefined): string[] | null {
  if (!raw || raw.length > 200) return null;
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_STOPS_PER_STATION) return null;
  if (!ids.every((id) => STOP_ID_RE.test(id))) return null;
  return ids.sort();
}
